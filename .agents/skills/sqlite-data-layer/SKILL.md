---
name: sqlite-data-layer
description: Work on Weekloom's SQLite data layer — the six tables and their DDL, appending a migration, the connection pragmas, the two JavaScript values node:sqlite refuses to bind, and why every function in lib/db is synchronous. Use when changing the schema, writing or reviewing a migration, adding a table or column, touching anything under lib/db/, writing a query or an RPC, or debugging a cascade, a constraint or a "cannot be bound" error.
---

# Weekloom's data layer

One SQLite file, `~/.weekloom/weekloom.db`, opened once by `lib/db/connection.ts`.

⚠️ **Nothing outside the `lib/db/` tree may import `node:sqlite`** — enforced by the
`no-restricted-imports` block in `eslint.config.mjs` and asserted again by
`tests/no-cloud-imports.test.ts`. The reason is `foreign_keys`, below.

## The six tables

`boards` → `blocks` → `items` → `steps`, plus `deadlines` (dated markers on a board) and
`user_settings` (one row, `CHECK (id = 1)`). The DDL is `lib/db/schema.ts`'s `V1` string.

- **`STRICT` on every table.** SQLite's default type affinity would silently accept `"true"` in an
  INTEGER column and `42` in a TEXT one. MEASURED: `STRICT` rejects both, **and** it enforces
  `NOT NULL` on a `TEXT PRIMARY KEY`, fixing SQLite's historical primary-key nullability quirk.
- **Booleans are `INTEGER 0/1` with a `CHECK`.** ⚠️ `lib/db/rows.ts` converts them, and skipping
  that mapper is worse than it sounds: because `0` is falsy, `archived ? …` _appears_ to work while
  `is_system === true` silently fails. That asymmetry is why the mapper is mandatory.
- **Timestamps are ISO-8601 UTC TEXT.** Dates (`items.start_date`, `deadlines.date`) and times
  (`steps.time_of_day`) are **floating local** text — `'YYYY-MM-DD'` and `'HH:MM[:SS]'`.
  ⚠️ **Never UTC-normalise them**: a task planned for Tuesday is planned for Tuesday wherever the
  laptop is. A `new Date(...)` round trip inside the data layer is a bug.
- **Ordered reads carry a `, id` tiebreaker**, so two rows with the same `sort_order` come back in
  the same order every time.
- `deadlines` has **no `updated_at`** and must not gain one: a deadline is created and deleted,
  never versioned.
- `items.recurrence` is TEXT with `CHECK (json_valid(...))`, parsed inside a try/catch by `toItem`.
  Nothing queries into it.
- ⚠️ **No unique index on `(item_id, origin_day_offset)`**, and negative origins are correct. Both
  absences are carried as explicit comments in the DDL naming the bug each would reintroduce — see
  the `recurring-series` skill before touching either.

## Migrations

`PRAGMA user_version` is the ledger, and it lives **inside the database file**, so it cannot drift
from the data it describes. `lib/db/schema.ts` holds `MIGRATIONS`, an ordered `{ version, sql }[]`;
each unapplied entry runs inside `BEGIN IMMEDIATE … PRAGMA user_version = N … COMMIT`, so a failure
rolls back and the version does not advance.

- **To change the schema, append `{ version: N + 1, sql }`** with the same kind of prose header the
  existing entries carry: what changed, why, and the failure it prevents.
- ⚠️ **Never edit a shipped entry and never renumber one.** Somebody's database is already past it
  and will never re-run it, so an edit changes what new installations get and nothing else — which
  is the definition of two databases claiming the same version and not being the same shape.
- ⚠️ **The SQL is a compiled-in TypeScript string, never a `.sql` file read at runtime.** Inside a
  packaged application there is no reliable "repository root" to resolve a data file against. A
  bundled string cannot fail to ship and cannot fail to be found.
- An older binary opening a newer file sees `user_version > SCHEMA_VERSION` and throws a clear
  error rather than running against a schema it does not understand; the shell surfaces it in the
  startup dialog. **This is what a developer hits when they switch to an older branch** — it is the
  designed outcome, not a bug.
- The `ROLLBACK` in the catch is guarded by `db.isTransaction`: SQLite closes the transaction
  itself on some errors (`SQLITE_FULL` is the one a user actually hits), and `ROLLBACK` with none
  open throws — replacing "disk is full" with "cannot rollback" in the dialog.

## Connection pragmas

Set in `lib/db/connection.ts`, in this order, on the one handle:

| pragma                 | why                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journal_mode = WAL`   | a page render (reader) and a Server Action (writer) overlap constantly; the default rollback journal blocks every reader for the length of a write |
| `foreign_keys = ON`    | ⚠️ see below                                                                                                                                       |
| `synchronous = NORMAL` | safe under WAL; `FULL` costs an fsync per commit for durability a desktop planner does not need                                                    |
| `busy_timeout = 5000`  | a transient lock becomes a wait rather than a `SQLITE_BUSY` thrown into the middle of a drag                                                       |

⚠️ **`foreign_keys` is a PER-CONNECTION pragma and OFF by default in SQLite.** `node:sqlite`
happens to default it on, but the setting that makes every `ON DELETE CASCADE` real is not a driver
default worth betting on. A second handle opened anywhere else would have foreign keys off, and the
symptom is a deleted board leaving every block, item and step behind with nothing reporting an
error. `lib/db/cascade.test.ts` asserts the **behaviour** — delete a block, count the orphans —
rather than that the pragma reads back `1`, which is not evidence that anything cascades.

WAL is also why `~/.weekloom` holds `weekloom.db-wal` and `weekloom.db-shm` beside the database.
They are one logical database; a backup that copies only `weekloom.db` can miss recent writes.

## ⚠️ Binding rules — `node:sqlite` throws on two ordinary JavaScript values

MEASURED, against the driver directly:

```
stmt.run("2", true)       → THROWS  "Provided value cannot be bound to SQLite parameter 2."
stmt.run("3", undefined)  → THROWS  (same message)
```

- **A JS `boolean` cannot be bound.** Convert to `0 | 1` first (`bindBool` / `encBool` in
  `lib/db/rows.ts`).
- **`undefined` cannot be bound.** A `Partial<Row>` patch must have its absent keys **omitted from
  the SQL**, never bound as `undefined` — which is what `buildPatch` is for.

Both are runtime throws on the hot write path, and `components/**` has no unit coverage, so a data
layer that got either wrong would not be caught by `npm test`. `lib/db/rows.test.ts` pins both.

## ⚠️ A `tx` callback contains NO `await`

`DatabaseSync` is synchronous and Node's event loop is single-threaded, so a function whose body
contains no `await` **cannot interleave with any other**. That is a stronger guarantee than a row
lock, and it is what makes the settings read-merge-write, `applyItemMove`'s all-or-nothing apply
and `materializeSeries`'s dedup-by-predicate correct with no locking at all.

**A single `await` inside a `tx` silently re-opens every race those three close**, because the
transaction would then span a yield point in which another request's synchronous statements run to
completion. This is why every function in `lib/db/**` is synchronous rather than `async` and merely
happening not to await. `lib/db/tx.ts`'s docstring states it, and also explains why a nested `tx`
joins the outer transaction and is **not** a savepoint.

## Other rules that have bitten

- **Delete a block's items before the block row.** `items.block_id` is `ON DELETE CASCADE` (it is
  `prev_block_id` and `deadline_id` that are `SET NULL`), so the explicit delete is belt-and-braces
  — but it is one statement, correct either way, and FK enforcement is per-connection, so it stays.
- **Undo writes UNGUARDED.** `lib/undo/sync.ts`'s `applyDiff` restores a snapshot over current
  state **by definition**, so any expectation check would reject every undo there has ever been.
  `lib/undo/sync.test.ts` asserts it never passes a row's `updated_at` to any write it issues.
- **No version guard anywhere, and none may be added.** One process, one writer — every rejection
  would be false. In particular do not add an expectation parameter to `applyItemMove` or
  `resizeItem`.

## Testing

`lib/db/test-support.ts`'s `setUpTempDb()` gives each case a fresh database in a temp directory
against the **real** engine, so constraints, partial unique indexes and cascades are genuinely
exercised rather than simulated. ⚠️ It is named `setUpTempDb`, not `useTempDb`, because the `use`
prefix makes eslint's react-hooks rule read it as a hook and refuse a top-level call.
