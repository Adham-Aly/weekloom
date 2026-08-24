/**
 * Weekloom's desktop shell.
 *
 * The product is an ordinary Next.js application. This process does four
 * things and deliberately nothing else:
 *
 *   1. makes sure `~/.weekloom` exists,
 *   2. picks a free loopback port and spawns `.next/standalone/server.js` on it,
 *   3. waits for `/api/health` to answer 200,
 *   4. opens a BrowserWindow on `http://127.0.0.1:<port>/app`.
 *
 * ## Why a child process rather than an in-process server
 *
 * Next's own documentation (`next/dist/docs/01-app/02-guides/custom-server.md`)
 * states that standalone output does not trace custom server files and that the
 * two "cannot be used together", so there is no supported programmatic entry
 * point. Beyond that, `server.js` calls `process.chdir()`, mutates
 * `process.env` and `process.exit()`s on a fatal error — running it in this
 * process would take the shell down with it and leave the user staring at a
 * window that never appeared, with no way to show a dialog.
 *
 * ## Why the renderer is on http://127.0.0.1 and never file://
 *
 * ⚠️ `components/gantt/board.tsx` mints ids with `crypto.randomUUID` and copies
 * with `navigator.clipboard`. Both are **secure-context-only**. An Electron
 * renderer on `file://` is not a secure context, so both are `undefined` and
 * the board throws the first time someone creates a task. `http://127.0.0.1`
 * IS a secure context (the loopback exception), and the standalone server needs
 * HTTP anyway. `tests/electron-shell-safety.test.ts` pins this, and
 * `e2e/shell.spec.ts` asserts `window.crypto.randomUUID` is callable in the
 * real window.
 *
 * ## Security posture, written down so it is not relitigated
 *
 * The server binds loopback only, so it is unreachable from another machine.
 * Next's Server Actions compare `Origin` against `Host` and abort on a
 * mismatch, which is the defence against a page in the user's ordinary browser
 * POSTing at the port. **No token or auth layer is added, deliberately:** any
 * local process running as this user can already open
 * `~/.weekloom/weekloom.db` directly, so an HTTP token would grant no privilege
 * it does not already have. The window runs with `contextIsolation`,
 * `sandbox` and no `nodeIntegration`, and there is **no preload script** — the
 * renderer is an ordinary web page and needs nothing privileged.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { installApplicationMenu } from "./menu";

// ─── Single instance ────────────────────────────────────────────────────

/**
 * Two instances would mean two Next servers and two writers on one SQLite file.
 * WAL plus `busy_timeout` would stop that corrupting the file, but two windows
 * editing settings would resurrect exactly the stale-snapshot overwrite that
 * `settingsDelta` exists to prevent. One instance; a second launch focuses the
 * first.
 */
const gotTheLock = app.requestSingleInstanceLock();

// ─── Where the data lives ───────────────────────────────────────────────

/**
 * ⚠️ Read the environment FIRST, exactly as `lib/db/connection.ts` does, and
 * FORWARD the result to the server child below. Hardcoding `os.homedir()` here
 * would make `_electron.launch({ env: { WEEKLOOM_DATA_DIR: tmp } })` a no-op
 * and point `e2e/shell.spec.ts` at the developer's real boards, which the suite
 * creates, drags and deletes against.
 *
 * ⚠️ `os.homedir()`, never `process.cwd()`: the standalone template calls
 * `process.chdir(__dirname)` as its third statement, so cwd is the server
 * directory inside the application bundle, not anything the user owns.
 */
const DATA_DIR =
  process.env.WEEKLOOM_DATA_DIR ?? path.join(os.homedir(), ".weekloom");

// ─── State ──────────────────────────────────────────────────────────────

let win: BrowserWindow | null = null;
let server: ChildProcess | null = null;
let quitting = false;
/** The port the running server bound. Read by the macOS `activate` handler. */
let livePort: number | null = null;
/**
 * The tail of the server's stderr. When startup fails this is the only thing
 * that says why, so it goes into the error dialog rather than into a log file
 * nobody will find.
 */
let stderrTail = "";

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Ask the OS for a free loopback port, then immediately give it back.
 *
 * ⚠️ There is an unavoidable race between closing this socket and the child
 * binding the port. It is handled by retrying with a FRESH port rather than by
 * pretending it cannot happen: Next's standalone template starts the server
 * with `allowRetry: false`, so a taken port is a hard child exit, not a
 * fallback to port+1.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address === null || typeof address === "string") {
        srv.close();
        reject(new Error("Could not obtain a loopback port."));
        return;
      }
      const { port } = address;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * The port the last successful launch used, remembered between launches.
 *
 * The port is part of the renderer's ORIGIN, and the origin is what keys
 * `localStorage` — so a fresh ephemeral port every launch would hand the window
 * a brand-new, empty `localStorage` every time. It is remembered in a one-line
 * file next to the database and tried first. Still never hardcoded and never
 * 3000: the FIRST launch asks the OS for whatever is free, and a remembered
 * port something else has since taken falls back to a fresh one rather than
 * failing.
 *
 * ⚠️ **Do not mistake this for an invariant.** Everything a person would miss
 * lives in the `user_settings` document, not in `localStorage` — chip mode, the
 * collapsed-item set and the last-used lane are all ordinary settings keys, for
 * exactly this reason. The three keys still in `localStorage` are a theme cache
 * the pre-hydration script reads before React exists (SQLite stays
 * authoritative), a per-day fired-notification ledger, and a debug flag. Losing
 * any of them costs one theme flash or one repeated notification.
 *
 * So this is a small comfort, not load-bearing. Nothing new should be built on
 * it; put durable state in `user_settings`. See AGENTS.md, "Why the port is
 * remembered".
 */
const PORT_FILE = path.join(DATA_DIR, "port");

/** Is this exact loopback port bindable right now? */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

function rememberedPort(): number | null {
  try {
    // A hand-edited or truncated file must not stop the app starting, so every
    // failure path here is "forget it and ask the OS", never a throw.
    const raw = Number.parseInt(fs.readFileSync(PORT_FILE, "utf8").trim(), 10);
    if (!Number.isInteger(raw) || raw < 1024 || raw > 65_535) return null;
    return raw;
  } catch {
    return null;
  }
}

function rememberPort(port: number): void {
  try {
    fs.writeFileSync(PORT_FILE, `${port}\n`, { mode: 0o600 });
  } catch {
    // Losing the file costs one launch's worth of window-local UI state, which
    // is not worth refusing to start over.
  }
}

/**
 * The port to try on this attempt: the remembered one if it is still free,
 * otherwise a fresh ephemeral one. Attempts after the first always take a
 * fresh port — if the remembered one did not work, trying it twice more is
 * just 60 seconds of the same failure.
 */
async function choosePort(attempt: number): Promise<number> {
  if (attempt === 1) {
    const previous = rememberedPort();
    if (previous !== null && (await portIsFree(previous))) return previous;
  }
  return freePort();
}

/**
 * Where `server.js` lives in each of the two shapes this app runs in.
 *
 * ⚠️ In a packaged build the Next server sits in `extraResources`, i.e.
 * OUTSIDE the asar archive. That is not a performance choice: `server.js` calls
 * `process.chdir(__dirname)`, and **you cannot chdir into an asar archive**.
 * See `electron-builder.yml`.
 */
function serverEntry(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app", "server.js")
    : path.join(__dirname, "..", "..", ".next", "standalone", "server.js");
}

/**
 * Show the failure and quit. ⚠️ Never leave a blank window: a shell that fails
 * silently is indistinguishable from one that is merely slow, and the user has
 * no log to consult.
 */
function fail(message: string): void {
  // Once, ever. Startup has several independent ways to notice the same
  // failure — the spawn erroring, the readiness poll timing out, the child
  // exiting — and stacking three modal dialogs on top of each other tells the
  // user nothing extra while making the app feel broken in a second way.
  if (quitting) return;
  quitting = true;
  const detail = stderrTail.trim();
  dialog.showErrorBox(
    "Weekloom could not start",
    detail === "" ? message : `${message}\n\n${detail}`,
  );
  app.quit();
}

function startServer(port: number): void {
  const entry = serverEntry();
  server = spawn(process.execPath, [entry], {
    /**
     * ⚠️ `ELECTRON_RUN_AS_NODE` makes Electron's own binary behave as plain
     * Node, which is why a user needs no Node installation to run the packaged
     * app — and why the SQLite driver must be `node:sqlite`: the runtime is
     * whatever Electron bundles, and a native addon would need rebuilding
     * against every Electron ABI.
     *
     * ⚠️ `HOSTNAME` is NOT optional. The standalone template is
     * `process.env.HOSTNAME || '0.0.0.0'` — without this line the server binds
     * every interface and serves the user's entire local database to anyone on
     * their network. `tests/electron-shell-safety.test.ts` pins it.
     */
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      WEEKLOOM_DATA_DIR: DATA_DIR,
    },
    cwd: path.dirname(entry),
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
  });
  server.on("error", (e: Error) => {
    if (!quitting)
      fail(`The Weekloom server could not be started: ${e.message}`);
  });
  server.on("exit", (code) => {
    if (quitting) return;
    // A crash AFTER the window opened. During startup `waitForReady` owns the
    // exit and retries on a fresh port, so this only fires once the app is up.
    if (win !== null)
      fail(`The Weekloom server stopped unexpectedly (exit ${code}).`);
  });
}

function stopServer(): void {
  if (server === null) return;
  const child = server;
  server = null;
  child.kill("SIGTERM");
  // ⚠️ Killing the child is not optional. An orphaned Next server keeps the
  // SQLite handle and the port after the window closes, and the next launch
  // then fails the single-writer assumption this shell is built on.
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }, 3000).unref();
}

/**
 * Poll `/api/health` until it answers 200.
 *
 * ⚠️ A real probe, not a stdout scrape. Next prints a human-facing banner whose
 * wording is undocumented and has changed between releases; parsing it would
 * make the shell fail on a version bump with no error anyone can act on.
 * Resolves `false` if the child exited during the window, which is the caller's
 * signal to retry on a fresh port.
 */
async function waitForReady(
  port: number,
  timeoutMs = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Something already reported a fatal failure and called `app.quit()`.
    // Polling on for another 30 seconds would keep the process alive past its
    // own error dialog.
    if (quitting) return false;
    if (
      server === null ||
      server.exitCode !== null ||
      server.signalCode !== null
    ) {
      return false;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.status === 200) return true;
    } catch {
      // Not listening yet. Expected for the first few hundred milliseconds.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function createWindow(port: number): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    // Matches --bg, so the frame does not flash white before the first paint.
    backgroundColor: "#08090d",
    show: false,
    title: "Weekloom",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // ⚠️ No preload script, deliberately. The renderer is an ordinary page
      // served over HTTP and needs nothing privileged — no file access, no
      // IPC, no native dialogs. An empty preload would be a bridge with
      // nothing to carry and one more surface to keep hardened. The Settings
      // "Data" row shows a constant path, so it needs no bridge either.
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });

  // ⚠️ `/app`, not `/` — one less redirect on a cold start, and `/` is the
  // same destination anyway.
  void win.loadURL(`http://127.0.0.1:${port}/app`);

  // ─── Navigation hardening ─────────────────────────────────────────────
  // Anything that is not this server opens in the user's real browser. A
  // second Electron window would be a chromeless, un-hardened browser with no
  // address bar, which is the worst of both.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

async function boot(): Promise<void> {
  // Created here as well as in `lib/db/connection.ts` — mkdir is idempotent,
  // and doing it here means the folder exists even if the server never starts,
  // which is what a first launch should leave behind.
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    // ⚠️ A missing bundle must not present as a hang. In development this
    // means `npm run build` has not been run; in a packaged app it means the
    // extraResources mapping in electron-builder.yml is wrong.
    fail(
      "The application bundle is incomplete (server.js is missing). " +
        `Expected it at:\n${entry}`,
    );
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await choosePort(attempt);
    startServer(port);
    if (await waitForReady(port)) {
      livePort = port;
      // Only a port that actually served a page is worth remembering.
      rememberPort(port);
      installApplicationMenu();
      createWindow(port);
      return;
    }
    stopServer();
    // A fatal error already surfaced (a failed spawn, say). Retrying twice more
    // would just spend 60 more seconds behind the dialog.
    if (quitting) return;
  }

  fail("The Weekloom server did not become ready after three attempts.");
}

// ─── Lifecycle ──────────────────────────────────────────────────────────

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win !== null) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // ⚠️ The `.catch` is load-bearing, not decoration. `boot` can reject —
  // `mkdirSync` on an unwritable home directory, `freePort` failing to bind
  // loopback at all — and an unhandled rejection here is the exact failure this
  // whole file exists to prevent: no window, no dialog, no log, a dock icon
  // that bounces once and does nothing.
  void app
    .whenReady()
    .then(boot)
    .catch((e: unknown) => {
      fail(
        `Weekloom failed to start: ${e instanceof Error ? e.message : String(e)}`,
      );
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    // macOS: closing the window does not quit the app, so the dock icon
    // reopens it against the server that is still running.
    if (BrowserWindow.getAllWindows().length === 0 && livePort !== null) {
      createWindow(livePort);
    }
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("will-quit", stopServer);
}
