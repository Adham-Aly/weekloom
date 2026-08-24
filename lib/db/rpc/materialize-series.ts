import { randomUUID } from "node:crypto";
import { nowISO } from "@/lib/db/now";
import type { SqliteRow } from "@/lib/db/rows";
import { tx } from "@/lib/db/tx";

export type MaterializeSeriesInput = {
  itemId: string;
  /** The offsets the rule says should exist. Produced by `planMaterialization`. */
  offsets: number[];
  /** The rule's time of day, stamped onto every occurrence this mints. */
  time: string;
  durationMin: number | null;
  /** The span the series now needs, or null when it needn't grow. */
  newDuration?: number | null;
};

/**
 * Create the occurrences a series is missing, and return how many were created.
 *
 * ## ⚠️ Dedup is on `origin_day_offset`, never on position
 *
 * The user may have dragged an occurrence off its rule slot. It is **still that
 * occurrence**, and inserting "because nothing sits at `day_offset` o" mints a
 * duplicate on top of it. `origin_day_offset` is where the RULE put the
 * occurrence; `day_offset` is where the USER put it.
 *
 * Dedup happens by **predicate inside a write transaction**, not by key
 * collision. That distinction is why there is no deterministic occurrence id
 * here: `upsert` on such a key clobbers a moved occurrence (dragging it back and
 * clearing `detached`), and `ON CONFLICT DO NOTHING` silently skips a genuinely
 * new one. Both failures exist only when there is no transaction to decide
 * inside. `BEGIN IMMEDIATE` (see `lib/db/tx.ts`) takes the write lock at
 * statement one, so the read that decides and the insert that acts cannot be
 * separated by another writer.
 */
export function materializeSeries(input: MaterializeSeriesInput): number {
  const { itemId, offsets, time, durationMin, newDuration } = input;

  return tx((db) => {
    const item = db
      .prepare("SELECT id, board_id, duration_days FROM items WHERE id = ?")
      .get(itemId) as SqliteRow | undefined;
    // A series deleted between planning and writing is not a failure: there is
    // nothing left to extend.
    if (!item) return 0;

    const boardId = String(item.board_id);
    const exists = db.prepare(
      "SELECT 1 FROM steps WHERE item_id = ? AND origin_day_offset = ? LIMIT 1",
    );
    const insert = db.prepare(
      "INSERT INTO steps (id, item_id, board_id, day_offset, origin_day_offset, " +
        "label, time_of_day, duration_min, status, detached, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, '', ?, ?, 'todo', 0, ?, ?)",
    );

    const at = nowISO();
    let created = 0;
    for (const o of offsets) {
      if (exists.get(itemId, o)) continue;
      insert.run(
        randomUUID(),
        itemId,
        boardId,
        o,
        // A minted occurrence sits exactly where the rule put it, so position
        // and origin start out equal. They diverge only when the user moves it.
        o,
        time,
        durationMin,
        at,
        at,
      );
      created++;
    }

    // ⚠️ GROWS ONLY. Shrinking here fights `resizeItem`, which owns that
    // decision, and orphans every step past the new end — `duration_days` is the
    // item's rendered span, not a count of its steps.
    if (newDuration != null && newDuration > Number(item.duration_days)) {
      db.prepare(
        "UPDATE items SET duration_days = ?, updated_at = ? WHERE id = ?",
      ).run(newDuration, at, itemId);
    }

    return created;
  });
}
