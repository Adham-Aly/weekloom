import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { GANTT_GRID, boardCard } from "./helpers";

/**
 * The desktop shell itself: the only spec that runs `electron/main.ts`.
 *
 * ⚠️ Requires `npm run app:build` first — it launches the compiled main
 * process (`electron/dist/main.js`, which is `package.json`'s `main`) and that
 * process spawns the real standalone server.
 *
 * ⚠️ It uses its OWN throwaway data directory, separate from the one the HTTP
 * suite uses, because it starts a SECOND server: one SQLite file, one writer.
 * `electron/main.ts` reads `WEEKLOOM_DATA_DIR` before falling back to
 * `os.homedir()` precisely so this line is not a no-op — hardcoding the home
 * directory there would point this spec at the developer's real boards, which
 * the rest of the suite creates and deletes against.
 *
 * ⚠️ **What this spec cannot cover: the macOS Edit menu.** Playwright's
 * synthetic keyboard events do not dispatch through a native application menu,
 * so whether ⌘C / ⌘V / ⌘Z reach the board's own handlers or are swallowed by
 * the menu roles has to be checked by hand on macOS. `electron/menu.ts` records
 * the two pre-authorised fixes.
 */

const SHELL_DATA_DIR = path.join(os.tmpdir(), "weekloom-e2e-shell");
const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * ⚠️ Three minutes, not Playwright's default thirty seconds. Each launch below
 * starts a real Electron process which spawns a real Next server and polls
 * `/api/health` for up to 30 s before it opens a window, and the second test
 * does that twice. MEASURED: with the default the first test died at exactly
 * 30.0 s — its own `timeout: 120_000` on `electron.launch` was unreachable,
 * because a per-call timeout can never outlive the test that contains it.
 */
test.describe.configure({ timeout: 180_000 });

test.describe("the Electron shell", () => {
  test("opens a window on loopback with a working secure context", async () => {
    const app = await electron.launch({
      args: [REPO_ROOT],
      cwd: REPO_ROOT,
      env: { ...process.env, WEEKLOOM_DATA_DIR: SHELL_DATA_DIR },
      timeout: 120_000,
    });

    try {
      // Named `win`, not `window`: a local called `window` shadows the DOM
      // global inside every `evaluate` callback below, and the browser-side
      // `window.crypto` stops typechecking.
      const win = await app.firstWindow({ timeout: 120_000 });
      await win.waitForLoadState("domcontentloaded");

      // ⚠️ Loopback HTTP, never file://.
      const url = new URL(win.url());
      expect(url.protocol).toBe("http:");
      expect(url.hostname).toBe("127.0.0.1");

      // ⚠️ The secure-context trap, made executable. `crypto.randomUUID` and
      // `navigator.clipboard` are secure-context-only; on file:// both are
      // undefined and the board throws the first time somebody creates a task.
      // http://127.0.0.1 is a secure context by the loopback exception, and
      // this is the assertion that proves the window really is on one.
      const uuid = await win.evaluate(() => window.crypto.randomUUID());
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(await win.evaluate(() => typeof navigator.clipboard)).not.toBe(
        "undefined",
      );

      // ⚠️ The shell loads `/app`, which is the board PICKER — not a board.
      // MEASURED: asserting a Gantt-grid marker here fails on a perfectly
      // healthy launch, because no board is open yet.
      await expect(boardCard(win, "My Board")).toBeVisible({ timeout: 30_000 });

      // …and a board opens from it, which is what "the app works" means. This
      // is also the first proof that a Server Component page renders inside the
      // shell rather than only over plain HTTP.
      await boardCard(win, "My Board").click();
      await expect(win.locator(GANTT_GRID)).toBeVisible({ timeout: 30_000 });

      // The database landed in the directory we pointed the shell at, which is
      // also the proof that WEEKLOOM_DATA_DIR is forwarded to the server child.
      expect(existsSync(path.join(SHELL_DATA_DIR, "weekloom.db"))).toBe(true);

      // ⚠️ The Edit menu is load-bearing on macOS: without it a native <input>
      // has no ⌘C/⌘V/⌘A. Its presence is checkable; its behaviour is not.
      const menuLabels = await app.evaluate(({ Menu }) =>
        (Menu.getApplicationMenu()?.items ?? []).map((i) => i.label),
      );
      expect(menuLabels).toContain("Edit");
    } finally {
      await app.close();
    }
  });

  test("a second instance is refused by the single-instance lock", async () => {
    const first = await electron.launch({
      args: [REPO_ROOT],
      cwd: REPO_ROOT,
      env: { ...process.env, WEEKLOOM_DATA_DIR: SHELL_DATA_DIR },
      timeout: 120_000,
    });
    try {
      // Positive control: the first instance really did open a window, so the
      // second one failing to is a refusal rather than a broken build.
      await first.firstWindow({ timeout: 120_000 });

      // ⚠️ The refusal shows up at LAUNCH, not at `firstWindow`. A second
      // instance loses `requestSingleInstanceLock()` and calls `app.quit()`
      // before it ever creates a window, so the process Playwright just
      // attached to exits and `electron.launch` itself rejects with "Target
      // page, context or browser has been closed". MEASURED: the previous form
      // of this test put only `firstWindow` inside the try, so the correct
      // behaviour was reported as an error.
      let opened = true;
      try {
        const second = await electron.launch({
          args: [REPO_ROOT],
          cwd: REPO_ROOT,
          env: { ...process.env, WEEKLOOM_DATA_DIR: SHELL_DATA_DIR },
          timeout: 60_000,
        });
        try {
          await second.firstWindow({ timeout: 8_000 });
        } finally {
          await second.close().catch(() => {});
        }
      } catch {
        opened = false;
      }
      // Two instances would be two Next servers and two writers on one SQLite
      // file — and two Settings windows racing the same JSON document.
      expect(opened).toBe(false);
    } finally {
      await first.close();
    }
  });
});
