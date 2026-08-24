/**
 * The command `playwright.config.ts`'s `webServer` runs.
 *
 * ## Why this exists rather than `globalSetup`
 *
 * MEASURED against the installed Playwright (1.62.1,
 * `playwright/lib/runner/index.js` → `createGlobalSetupTasks`): the `webServer`
 * plugin's setup task runs **before** `globalSetup`. So anything that must
 * happen before the server boots — copying the static assets it will serve,
 * emptying the throwaway data directory it is about to create a database in —
 * cannot live in `globalSetup`. It lives here, in the command itself, which is
 * the only hook that is genuinely earlier than the server.
 *
 * ## What it guarantees
 *
 *   1. ⚠️ The suite drives the **production standalone build**, the same
 *      artifact the desktop app ships — never `next dev`. A dev build differs
 *      in bundling, in Server Action encoding and in `force-dynamic`
 *      behaviour. If the build is missing this exits non-zero with a message
 *      rather than starting something else; a run must ERROR, not quietly test
 *      the wrong thing.
 *   2. `public/` and `.next/static` sit beside `server.js`, or every stylesheet
 *      and chunk 404s and the whole suite fails on selectors for an unstyled
 *      page.
 *   3. ⚠️ The data directory is emptied first, so `e2e/first-run.spec.ts`
 *      exercises a genuine first run — and so no run inherits the previous
 *      run's boards.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");
const SERVER = path.join(STANDALONE, "server.js");

function die(message) {
  console.error(`e2e/serve: ${message}`);
  process.exit(1);
}

if (!existsSync(SERVER)) {
  die(
    ".next/standalone/server.js is missing. Run `npm run app:build` first — " +
      "the suite drives the production build, never `next dev`.",
  );
}

execFileSync(
  process.execPath,
  [path.join(ROOT, "scripts", "prepare-standalone.mjs")],
  { stdio: "inherit" },
);

const dataDir = process.env.WEEKLOOM_DATA_DIR;
if (dataDir === undefined || dataDir === "") {
  die(
    "WEEKLOOM_DATA_DIR is not set. Refusing to start, because the server would " +
      "otherwise create and mutate the real ~/.weekloom database.",
  );
}

// ⚠️ A safety interlock, not a formality: this deletes a directory. It may only
// ever delete one inside the OS temp directory whose name this harness chose.
// If someone points WEEKLOOM_E2E_DATA_DIR at their home folder, refuse rather
// than obey.
const tmp = path.resolve(os.tmpdir());
const resolved = path.resolve(dataDir);
if (
  !resolved.startsWith(tmp + path.sep) ||
  !path.basename(resolved).startsWith("weekloom-e2e")
) {
  die(
    `refusing to wipe ${resolved}. A throwaway e2e data directory must live ` +
      `under ${tmp} and be named weekloom-e2e*.`,
  );
}
rmSync(resolved, { recursive: true, force: true });
console.log(`e2e/serve: data directory reset -> ${resolved}`);

const child = spawn(process.execPath, [SERVER], {
  cwd: STANDALONE,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
