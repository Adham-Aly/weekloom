import { DbInvalidInputError, DbMissingRowError } from "@/lib/db/errors";
import { nowISO } from "@/lib/db/now";
import type { SqliteRow } from "@/lib/db/rows";
import { tx } from "@/lib/db/tx";

/**
 * Exchange the day positions of two steps of the same item.
 *
 * ## ⚠️ Both statements set `detached = 1`, in the same statement as the move
 *
 * A swap **is** a manual placement: it is the only writer that moves a step off
 * its rule slot. The materializer asserts that a non-detached step is still
 * exactly where the rule put it — that assumption is what lets its watermark
 * read a step's position as a rule slot — and a swap that moved `day_offset`
 * without saying so made the assumption false. Reproduced against the real
 * planner: a Monday series with one detached step, swap two of its occurrences,
 * and the plan collapsed from six offsets to one. **Five occurrences silently
 * skipped**, because the swapped step poisons the watermark.
 *
 * The alternative — teaching the materializer to read `max(day_offset, origin)`
 * — papers over it and leaves the assertion lying. Setting the flag MAKES THE
 * ASSERTED INVARIANT TRUE. Delete `detached = 1` from either statement below and
 * `lib/db/rpc/swap-steps.test.ts` goes red.
 *
 * ## ⚠️ `origin_day_offset` is deliberately NOT touched
 *
 * It is the slot the RULE put the occurrence in, and a user moving the
 * occurrence does not change that. Freezing it is the column's entire job.
 *
 * Harmless for non-recurring items, which are the overwhelming majority of
 * swaps: nothing reads `detached` outside the recurring rotation, and their
 * `origin_day_offset` is null so materialization never considers them.
 */
export function swapSteps(a: string, b: string): void {
  tx((db) => {
    const read = db.prepare(
      "SELECT id, item_id, day_offset FROM steps WHERE id = ?",
    );
    const rowA = read.get(a) as SqliteRow | undefined;
    const rowB = read.get(b) as SqliteRow | undefined;
    if (!rowA) throw new DbMissingRowError(`Step not found: ${a}`);
    if (!rowB) throw new DbMissingRowError(`Step not found: ${b}`);
    if (String(rowA.item_id) !== String(rowB.item_id)) {
      // Not a missing row: both exist, and the request is the thing that is
      // impossible. Swapping across items would move a step between tasks.
      throw new DbInvalidInputError("steps must belong to the same item");
    }

    const at = nowISO();
    const write = db.prepare(
      "UPDATE steps SET day_offset = ?, detached = 1, updated_at = ? WHERE id = ?",
    );
    write.run(Number(rowB.day_offset), at, a);
    write.run(Number(rowA.day_offset), at, b);
  });
}
