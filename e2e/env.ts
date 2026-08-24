/**
 * The one place the end-to-end harness decides WHERE it writes and WHICH port
 * it uses. `playwright.config.ts` and the specs both import from here, so they
 * cannot disagree.
 *
 * ⚠️ **`DATA_DIR` must never be the user's real `~/.weekloom`.** The suite
 * creates boards, drags bars and deletes blocks; pointed at a real database it
 * would destroy someone's planning. `playwright.config.ts` forwards this value
 * to the server as `WEEKLOOM_DATA_DIR`, `lib/db/connection.ts` reads it, and
 * `electron/main.ts` reads it too so `e2e/shell.spec.ts` can point the real
 * desktop shell somewhere harmless.
 *
 * The path is DETERMINISTIC rather than per-pid on purpose: a spec has to be
 * able to `stat` the database the server created, and a worker process has a
 * different pid from the config that spawned the server. `e2e/serve.mjs`
 * empties it before the server starts — NOT `globalSetup`, which Playwright
 * runs *after* the `webServer` plugin and therefore after the database already
 * exists; that measurement is in `serve.mjs`'s own docstring. So
 * "deterministic" does not mean "stale".
 */

import os from "node:os";
import path from "node:path";

/** Overridable so a developer can inspect a run's database afterwards. */
export const DATA_DIR =
  process.env.WEEKLOOM_E2E_DATA_DIR ??
  path.join(os.tmpdir(), "weekloom-e2e-data");

export const DB_FILE = path.join(DATA_DIR, "weekloom.db");

/** ⚠️ Never 3000 — that is the development server's port. */
export const PORT = Number(process.env.WEEKLOOM_E2E_PORT ?? 3999);

export const BASE_URL = `http://127.0.0.1:${PORT}`;
