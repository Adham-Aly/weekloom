import { DbInvalidInputError, DbMissingRowError } from "@/lib/db/errors";
import { nowISO } from "@/lib/db/now";
import type { SqliteRow } from "@/lib/db/rows";
import { tx } from "@/lib/db/tx";
import { daysBetweenISO } from "@/lib/calendar/recurrence";

/**
 * Move an item's steps — and optionally the item itself — in one atomic write.
 *
 * This runs on **every drag**, and it is the only write path in the app that is
 * not a single row. That is the whole reason it is a function rather than a
 * sequence of updates: a partial apply would leave an item whose steps sit at a
 * mix of old and new offsets, and a half-moved task is worse than any failure
 * this could report.
 *
 * ## ⚠️ There is no expectation parameter, and none may be re-added
 *
 * The hosted version took an expected `updated_at` per step so a concurrent
 * writer could be detected. There is one writer here. A guard would reject
 * nothing real and every rejection it produced would be false — and the
 * standing prohibition on adding a version guard to a move survives the port for
 * that reason. Note also that this returns **void**: a landed move cannot report
 * a version, which is what stops a caller inventing a version chain on top of it.
 */
export type ApplyItemMoveInput = {
  itemId: string;
  stepUpdates: { id: string; day_offset: number }[];
  newStartDate?: string | null;
  newDuration?: number | null;
  newDeadlineOffset?: number | null;
  /**
   * How far the recurrence RULE itself moved. `0` for every gesture except a
   * scope-all weekday rotation.
   *
   * ⚠️ **REQUIRED, and deliberately so — never `?? 0`, never `.default(0)`.** It
   * cannot be derived here: a rotation and a user arrow-shifting one cell arrive
   * in the IDENTICAL shape (N `stepUpdates`, no `newStartDate`) and need
   * OPPOSITE `origin_day_offset` behaviour — shift versus freeze. Only the
   * caller knows which gesture happened.
   *
   * It was optional once, on the reasoning that 0 is the true value for every
   * caller but one. The one caller that needed a non-zero value simply didn't
   * pass it, the default supplied 0, and every origin froze through a rotation:
   * the materializer then found no origin at the new slot and minted a duplicate
   * on top of each occurrence that had already moved. Nothing failed; it took a
   * reviewer sweep to notice. **A correct default is still a default — it
   * answers for a caller who never spoke.**
   */
  ruleDelta: number;
};

export function applyItemMove(input: ApplyItemMoveInput): void {
  const { itemId, stepUpdates, ruleDelta } = input;

  // ── 1. The request must be self-consistent before anything is read ──
  const ids = stepUpdates.map((u) => u.id);
  if (ids.some((id) => !id)) {
    throw new DbInvalidInputError("step updates must all carry an id");
  }
  if (new Set(ids).size !== ids.length) {
    // ⚠️ A DUPLICATE IS NOT A MISSING ROW, and the distinct class is what keeps
    // it visible. A set-based update that silently applies one of two duplicate
    // source rows returns a short matched count, so the function reports a
    // *concurrency conflict* — and the caller then tells the person their task
    // changed underneath them when nothing changed at all. Deduping instead
    // would hide the ambiguity — two offsets for one step, silently picking
    // one.
    throw new DbInvalidInputError(
      `duplicate step id in one move (${ids.length} entries, ${new Set(ids).size} distinct)`,
    );
  }

  tx((db) => {
    // ── 2. Read the item BEFORE updating it ──
    const item = db
      .prepare("SELECT id, start_date FROM items WHERE id = ?")
      .get(itemId) as SqliteRow | undefined;
    if (!item) throw new DbMissingRowError(`Item not found: ${itemId}`);

    // ── 3. The rebase: OLD start minus NEW start, plus the rule's own move ──
    //
    // `origin_day_offset` lives in offsets-from-`start_date`. ONLY a change to
    // `start_date` changes that coordinate system; everything else in
    // `stepUpdates` is the user moving an occurrence WITHIN it. So origin
    // absorbs exactly the coordinate change and nothing else, and the per-step
    // remainder — the drag — is what origin must ignore.
    //
    // ⚠️ THE SIGN IS NOT ARBITRARY. When the start slides two days earlier, a
    // fixed calendar occurrence's offset from that start GROWS by two, so its
    // origin must grow with it. `daysBetweenISO(a, b)` returns b − a in whole
    // local days, so `daysBetweenISO(newStartDate, item.start_date)` is exactly
    // old − new.
    //
    // ⚠️ THE ITEM MUST NOT HAVE BEEN UPDATED YET. Write it first and this delta
    // is zero, every origin freezes, and the materializer mints a duplicate on
    // top of every step that moved.
    const { newStartDate, newDuration, newDeadlineOffset } = input;
    const itemDelta =
      newStartDate != null
        ? daysBetweenISO(newStartDate, String(item.start_date))
        : 0;
    const rebase = itemDelta + ruleDelta;

    // ── 4. Ownership pre-check, before any write ──
    //
    // A step that vanished, or was reparented onto another item, aborts the
    // whole move rather than applying the part of it that still matches.
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      const present = db
        .prepare(
          `SELECT count(*) AS n FROM steps WHERE item_id = ? AND id IN (${placeholders})`,
        )
        .get(itemId, ...ids) as { n: number | bigint };
      const found = Number(present.n);
      if (found !== ids.length) {
        throw new DbMissingRowError(
          `${ids.length - found} of ${ids.length} steps are missing or no longer belong to item ${itemId}`,
        );
      }
    }

    // ── 5. Move the steps ──
    const at = nowISO();
    const move = db.prepare(
      "UPDATE steps " +
        "   SET day_offset = ?, " +
        // ⚠️ A NULL ORIGIN STAYS NULL. A step with no origin is not a
        // rule-generated occurrence (an `addStepAt` step, a `resizeItem` tail
        // row); it answers no question the watermark asks, and giving it one
        // makes the materializer treat it as an occurrence.
        "       origin_day_offset = CASE WHEN origin_day_offset IS NULL " +
        "                               THEN NULL ELSE origin_day_offset + ? END, " +
        "       updated_at = ? " +
        " WHERE id = ? AND item_id = ?",
    );
    for (const u of stepUpdates) {
      // ⚠️ NEGATIVE RESULTS ARE STORED, NEVER CLAMPED. A negative origin is
      // CORRECT, not merely tolerable: the step's absolute date has moved off
      // the rule's date, so the rule's slot is genuinely vacant and minting into
      // it later is right. `greatest(0, …)` is the actual bug — it collapses two
      // distinct occurrences onto one origin and the series duplicates.
      move.run(u.day_offset, rebase, at, u.id, itemId);
    }

    // ── 6. Move the item, if the caller asked for it ──
    if (
      newStartDate != null ||
      newDuration != null ||
      newDeadlineOffset != null
    ) {
      db.prepare(
        "UPDATE items " +
          "   SET start_date      = COALESCE(?, start_date), " +
          "       duration_days   = COALESCE(?, duration_days), " +
          "       deadline_offset = COALESCE(?, deadline_offset), " +
          "       updated_at      = ? " +
          " WHERE id = ?",
      ).run(
        newStartDate ?? null,
        newDuration ?? null,
        newDeadlineOffset ?? null,
        at,
        itemId,
      );
    }
  });
}
