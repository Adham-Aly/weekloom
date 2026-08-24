import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db/connection";

/**
 * Run `fn` inside one write transaction and return its value.
 *
 * ## ⚠️ A `tx` callback contains no `await`, ever
 *
 * `DatabaseSync` is synchronous and Node's event loop is single-threaded, so a
 * function whose body contains no `await` **cannot interleave with any other**.
 * That is a stronger guarantee than a row lock gave, and it is what makes the
 * settings read-merge-write, `applyItemMove`'s all-or-nothing apply and
 * `materializeSeries`'s dedup-by-predicate correct without any locking at all.
 *
 * **Introducing a single `await` inside a `tx` callback silently re-opens every
 * race those three close**, because the transaction would then span a yield
 * point in which another request's synchronous statements run to completion.
 * This is why every function in `lib/db/**` is synchronous rather than `async`
 * and merely happening not to await.
 *
 * ## `BEGIN IMMEDIATE`, not `BEGIN`
 *
 * A plain `BEGIN` is deferred: it takes the write lock at the first write
 * statement, so a read taken earlier in the transaction was taken outside it and
 * can be stale by the time the write lands. `BEGIN IMMEDIATE` takes the write
 * lock at statement one, which is exactly what `SELECT … FOR UPDATE` bought in
 * Postgres — `materializeSeries` reads an item, decides what is missing, and
 * inserts, and that whole sequence has to be one decision.
 *
 * ## Nesting joins the outer transaction; it does not open a second one
 *
 * SQLite has no nested transactions, and a composite operation is built from
 * primitives that are each atomic on their own (`createItemWithSteps` wraps
 * `upsertItem` + `upsertSteps`, and `upsertSteps` is itself a `tx`). So a nested
 * call runs inline: the OUTERMOST `tx` owns `BEGIN`/`COMMIT`/`ROLLBACK` and its
 * atomicity subsumes the inner one.
 *
 * ⚠️ The consequence, stated rather than discovered: a nested `tx` is **not** a
 * savepoint. A throw inside one rolls the whole outer transaction back when it
 * propagates — but an outer caller that *swallows* that error keeps whatever the
 * outer transaction had already written. Do not catch-and-continue inside a
 * `tx`. (`materializeAll` does catch per series, and is deliberately not itself
 * a `tx` for exactly this reason: each series is its own outermost transaction.)
 */
export function tx<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  if (db.isTransaction) return fn(db);

  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (e) {
    // SQLite rolls back and closes the transaction itself on some errors, and
    // `ROLLBACK` with none open throws — which would replace the real error with
    // a misleading one. Ask whether there is anything to roll back rather than
    // wrapping the rollback in a catch that swallows both cases alike.
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}
