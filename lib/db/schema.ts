/**
 * The schema, and the ledger that applies it.
 *
 * ⚠️ **The SQL is a compiled-in TypeScript string, never a `.sql` file read at
 * runtime.** Inside a packaged desktop app there is no reliable "the repo root"
 * to resolve a data file against — the Next standalone server `chdir()`s into
 * its own directory and the app bundle is not a normal filesystem. A bundled
 * string cannot fail to ship and cannot fail to be found.
 *
 * ## The versioning convention (this replaces a migrations folder)
 *
 * `PRAGMA user_version` is the ledger, and it lives *inside* the database file,
 * so it cannot drift from the data it describes. To change the schema, **append**
 * `{ version: N + 1, sql: … }` to `MIGRATIONS` with the same kind of prose
 * header the entries below carry: what changed, why, and the failure it
 * prevents.
 *
 * ⚠️ **Never edit a shipped entry and never renumber one.** Someone's database
 * file is already past it and will never re-run it, so an edit changes what new
 * installs get and nothing else — which is the definition of two databases that
 * claim the same version and are not the same shape.
 */
import type { DatabaseSync } from "node:sqlite";

/**
 * Version 1 — the whole product.
 *
 * Table order matters: `items` references `deadlines`, so `deadlines` is
 * created first.
 *
 * Booleans are INTEGER 0/1 with a CHECK; `lib/db/rows.ts` converts to and from
 * JS booleans so nothing above that layer ever sees a number where the types
 * promise a boolean. Timestamps are ISO-8601 UTC TEXT. Dates
 * (`items.start_date`, `deadlines.date`) and times (`steps.time_of_day`) are
 * FLOATING LOCAL text — 'YYYY-MM-DD' and 'HH:MM[:SS]'. ⚠️ Never UTC-normalise
 * them: a task planned for Tuesday is planned for Tuesday wherever the laptop
 * is.
 *
 * ⚠️ `STRICT` on every table. SQLite's default type affinity would silently
 * accept `"true"` in an INTEGER column and `42` in a TEXT one; STRICT makes the
 * declared type enforced, and it also enforces NOT NULL on a TEXT PRIMARY KEY
 * (fixing SQLite's historical PK-nullability quirk). The explicit NOT NULL on
 * each `id` is belt-and-braces and costs nothing.
 */
const V1 = `
CREATE TABLE boards (
  id         TEXT    NOT NULL PRIMARY KEY,
  name       TEXT    NOT NULL,
  color      TEXT,
  icon       TEXT,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
) STRICT;

CREATE TABLE blocks (
  id         TEXT    NOT NULL PRIMARY KEY,
  board_id   TEXT    NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#f59e0b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed  INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  is_system  INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  icon       TEXT,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  CONSTRAINT blocks_icon_length CHECK (icon IS NULL OR length(icon) <= 64)
) STRICT;
CREATE INDEX blocks_board_id_idx   ON blocks(board_id);
CREATE INDEX blocks_board_sort_idx ON blocks(board_id, sort_order);
-- A board has at most one system block of a given name; ordinary user lanes may
-- share a name freely. A partial unique index is the only shape that says that.
CREATE UNIQUE INDEX blocks_unique_system_per_board_name
  ON blocks(board_id, name) WHERE is_system = 1;

CREATE TABLE deadlines (
  id         TEXT NOT NULL PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  date       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#ef4444',
  created_at TEXT NOT NULL
  -- ⚠️ Deliberately NO updated_at, and it must not gain one. Deadlines are
  -- created and deleted, never versioned, and nothing reads a deadline's mtime.
) STRICT;
CREATE INDEX deadlines_board_id_idx ON deadlines(board_id);
CREATE INDEX deadlines_date_idx     ON deadlines(date);

CREATE TABLE items (
  id              TEXT    NOT NULL PRIMARY KEY,
  board_id        TEXT    NOT NULL REFERENCES boards(id)    ON DELETE CASCADE,
  -- ⚠️ CASCADE, not SET NULL. Deleting a lane deletes the tasks in it; it is
  -- prev_block_id that is SET NULL, so a deleted lane cannot leave a dangling
  -- "where it came from" pointer behind.
  block_id        TEXT             REFERENCES blocks(id)    ON DELETE CASCADE,
  prev_block_id   TEXT             REFERENCES blocks(id)    ON DELETE SET NULL,
  deadline_id     TEXT             REFERENCES deadlines(id) ON DELETE SET NULL,
  title           TEXT    NOT NULL,
  start_date      TEXT    NOT NULL,
  duration_days   INTEGER NOT NULL DEFAULT 1 CHECK (duration_days   >= 1),
  deadline_offset INTEGER NOT NULL DEFAULT 1 CHECK (deadline_offset >= 0),
  color           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  recurrence      TEXT             CHECK (recurrence IS NULL OR json_valid(recurrence)),
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
) STRICT;
CREATE INDEX items_board_id_idx   ON items(board_id);
CREATE INDEX items_block_sort_idx ON items(block_id, sort_order);

CREATE TABLE steps (
  id                TEXT    NOT NULL PRIMARY KEY,
  item_id           TEXT    NOT NULL REFERENCES items(id)  ON DELETE CASCADE,
  board_id          TEXT    NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  day_offset        INTEGER NOT NULL CHECK (day_offset >= 0),
  label             TEXT    NOT NULL DEFAULT '',
  time_of_day       TEXT,
  duration_min      INTEGER,
  notes             TEXT,
  status            TEXT    NOT NULL DEFAULT 'todo'
                      CHECK (status IN ('todo', 'in_progress', 'done', 'blocked')),
  completed_at      TEXT,
  detached          INTEGER NOT NULL DEFAULT 0 CHECK (detached IN (0, 1)),
  origin_day_offset INTEGER,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
  -- ⚠️ TWO constraints are deliberately ABSENT, and adding either is a
  -- reproduced bug, not a tightening:
  --
  --  1. No UNIQUE(item_id, origin_day_offset). Detached and non-detached
  --     occurrences share the origin space. Origins {1,8,15,22}; the user
  --     detaches 15 (origin frozen at 15, position now 20); a scope-"all" drag
  --     of +7 rotates the non-detached {1,8,22} to {8,15,29}; the rebased
  --     8 -> 15 collides with the frozen 15 and the user's drag fails. Dedup by
  --     predicate inside a write transaction (lib/db/rpc/materialize-series.ts),
  --     never by constraint.
  --
  --  2. No CHECK (origin_day_offset >= 0). A NEGATIVE origin is CORRECT: when an
  --     item's start_date slides later, a fixed occurrence's offset from that
  --     start goes down and may pass zero. It never dedups anything (rule
  --     offsets are all >= 0) and that is right — the step's absolute date is no
  --     longer the rule's date, so the rule's slot is genuinely vacant. Clamping
  --     with greatest(0, …) collapses two distinct occurrences onto one origin
  --     and the series duplicates.
) STRICT;
CREATE INDEX steps_board_id_idx    ON steps(board_id);
CREATE INDEX steps_item_offset_idx ON steps(item_id, day_offset);
CREATE INDEX steps_completed_idx   ON steps(completed_at);

-- One user, one settings document. The CHECK is what makes "singleton" a
-- property of the schema rather than a habit of the code above it.
CREATE TABLE user_settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  settings   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  updated_at TEXT    NOT NULL
) STRICT;
`;

export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  { version: 1, sql: V1 },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Bring `db` up to `SCHEMA_VERSION`, and return the version it now holds.
 *
 * Idempotent: already-applied versions are skipped, so this runs on every open.
 * Each unapplied migration runs inside its own `BEGIN IMMEDIATE … COMMIT`, so a
 * migration that throws leaves neither a half-created table nor an advanced
 * version number.
 */
export function migrate(db: DatabaseSync): number {
  const current = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
  );

  // A user-owned file opened by an older build. Running the app against a schema
  // it does not understand corrupts data slowly and silently; refusing is one
  // line and the failure is legible. `electron/main.ts` surfaces this message in
  // the startup dialog.
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `This database was written by a newer version of Weekloom (schema ${current}, this build understands ${SCHEMA_VERSION}).`,
    );
  }

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      // ⚠️ `PRAGMA user_version` cannot be parameterised — a prepared statement
      // with a placeholder here silently does nothing. The value comes from the
      // module-level literal array above and never from input, so the
      // interpolation is safe by construction. Do not "fix" it.
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (e) {
      // ⚠️ Guarded, for the reason `lib/db/tx.ts` gives at length: SQLite rolls
      // back and closes the transaction itself on some errors (SQLITE_FULL is
      // the one a user actually hits), and `ROLLBACK` with none open throws —
      // which would replace "database or disk is full" with "cannot rollback -
      // no transaction is active" in the startup dialog `electron/main.ts`
      // shows. The two transaction owners in this tree must agree.
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  }
  return SCHEMA_VERSION;
}
