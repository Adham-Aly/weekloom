import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "@/lib/db/schema";

/**
 * The single database handle, its location, and the pragmas that make the rest
 * of `lib/db/**` correct.
 *
 * ⚠️ **Nothing outside `lib/db/**` may import `node:sqlite`** — an eslint rule
 * enforces it. A second handle is a second connection, and the pragmas below are
 * per-connection: a second connection has foreign keys *off*, which silently
 * disables every `ON DELETE CASCADE` in the schema. The symptom is a deleted
 * board leaving every block, item and step behind, with nothing reporting an
 * error.
 */

/**
 * Where the user's data lives.
 *
 * `WEEKLOOM_DATA_DIR` exists for tests and the Playwright harness ONLY, so a
 * test run can never touch a real person's boards. There is no user-facing way
 * to set it and no setting that reads it.
 *
 * ⚠️ **Never derive this from `process.cwd()`.** The Next standalone server does
 * `process.chdir(__dirname)` before it serves anything, and inside a packaged
 * desktop app the working directory is not the app root either. The home
 * directory is the only anchor that is true in all three runtimes (dev server,
 * standalone server, packaged app).
 */
export function dataDir(): string {
  return process.env.WEEKLOOM_DATA_DIR ?? path.join(os.homedir(), ".weekloom");
}

export function dbPath(): string {
  return path.join(dataDir(), "weekloom.db");
}

type Handle = { db: DatabaseSync; path: string };

/**
 * Memoized on `globalThis` rather than in a module-scoped `let`, because Next's
 * dev server re-evaluates modules on every edit. A module-scoped handle would
 * leak a new connection per reload, and each new one would race the previous
 * one's WAL writes.
 */
const HANDLE_KEY = Symbol.for("weekloom.db.handle");
type HandleCarrier = typeof globalThis & { [HANDLE_KEY]?: Handle };

export function getDb(): DatabaseSync {
  const carrier: HandleCarrier = globalThis;
  const wanted = dbPath();
  const existing = carrier[HANDLE_KEY];
  // The path check matters for tests, which repoint `WEEKLOOM_DATA_DIR` between
  // cases: a handle memoized against the previous temp directory would keep
  // answering from a database the current test never wrote to.
  if (existing && existing.db.isOpen && existing.path === wanted) {
    return existing.db;
  }
  // Guarded on `isOpen` rather than wrapped in a catch: closing an already
  // closed handle is the only expected failure, and swallowing every other one
  // would hide a real problem behind a replaced connection.
  if (existing?.db.isOpen) existing.db.close();

  // 0700: the operating system's file permissions are what stands in for the
  // row-level security a hosted database provided. One user, one process, one
  // file — nobody else on the machine gets to read it.
  fs.mkdirSync(path.dirname(wanted), { recursive: true, mode: 0o700 });

  const db = new DatabaseSync(wanted);
  try {
    applyPragmas(db);
    migrate(db);
  } catch (e) {
    // A database written by a newer build throws here. Leaving the handle open
    // would hold a lock on the user's file for the life of the process, so the
    // startup dialog would be reporting one problem while quietly causing a
    // second. Close it and let the error out.
    db.close();
    throw e;
  }

  carrier[HANDLE_KEY] = { db, path: wanted };
  return db;
}

function applyPragmas(db: DatabaseSync): void {
  // A page render (reader) and a Server Action (writer) overlap constantly.
  // Under the default rollback journal the writer blocks every reader.
  db.exec("PRAGMA journal_mode = WAL");
  // ⚠️ PER CONNECTION, and OFF by default in SQLite. `node:sqlite` happens to
  // default it on, but the pragma that makes every ON DELETE CASCADE real is not
  // a driver default worth betting on. `lib/db/cascade.test.ts` asserts the
  // resulting BEHAVIOUR, not this setting, because the setting reading back as 1
  // is not evidence that a delete cascades.
  db.exec("PRAGMA foreign_keys = ON");
  // Safe under WAL. FULL costs an fsync per commit and buys durability against
  // an OS crash that a desktop planner does not need.
  db.exec("PRAGMA synchronous = NORMAL");
  // A transient lock becomes a wait rather than a SQLITE_BUSY thrown into the
  // middle of a drag.
  db.exec("PRAGMA busy_timeout = 5000");
}

/**
 * Close and forget the handle. **Tests only** — the application opens the
 * database once per server process and keeps it for the process' lifetime.
 */
export function closeDb(): void {
  const carrier: HandleCarrier = globalThis;
  const existing = carrier[HANDLE_KEY];
  delete carrier[HANDLE_KEY];
  if (existing?.db.isOpen) existing.db.close();
}
