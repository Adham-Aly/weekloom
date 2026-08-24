import { randomUUID } from "node:crypto";
import { nowISO } from "@/lib/db/now";
import type { SqliteRow } from "@/lib/db/rows";
import { tx } from "@/lib/db/tx";

/**
 * The first-run bootstrap: what "the user opens Weekloom for the first time"
 * means concretely.
 *
 * After this runs the user has one board with a lane to put a task in and the
 * Completed lane the board needs to exist. Nothing else — no sample tasks, no
 * invented content in somebody's only real board.
 *
 * ## ⚠️ The guards are predicates, not constraints, and that is what makes this
 * idempotent on EVERY launch rather than only the first
 *
 * Each step asks "is there already one of these?" and does nothing if so. So a
 * user who deleted the `General` lane on purpose does not get it back, a second
 * `Completed` is never created (which would violate the partial unique index
 * anyway), and a board that has been renamed keeps its name. Running this a
 * hundred times leaves the same database as running it once.
 *
 * The advisory lock the hosted version took is dropped: there is one process,
 * held by a single-instance lock, and `tx`'s `BEGIN IMMEDIATE` plus a body with
 * no `await` already makes the whole sequence indivisible.
 */
export function seedLocalData(): void {
  tx((db) => {
    const at = nowISO();

    let board = db
      .prepare(
        "SELECT id FROM boards ORDER BY sort_order, created_at, id LIMIT 1",
      )
      .get() as SqliteRow | undefined;

    if (!board) {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO boards (id, name, archived, sort_order, created_at, updated_at) " +
          "VALUES (?, 'My Board', 0, 0, ?, ?)",
      ).run(id, at, at);
      board = { id };
    }
    const boardId = String(board.id);

    // The Completed lane. Items move here automatically once all their steps are
    // done, so the board renders it through `completed-section.tsx` rather than
    // as an ordinary lane, and `deleteBlock` refuses to remove it. `is_system`
    // is what makes both of those true.
    const hasCompleted = db
      .prepare(
        "SELECT 1 FROM blocks WHERE board_id = ? AND is_system = 1 AND name = 'Completed' LIMIT 1",
      )
      .get(boardId);
    if (!hasCompleted) {
      db.prepare(
        "INSERT INTO blocks (id, board_id, name, color, sort_order, is_system, created_at, updated_at) " +
          "VALUES (?, ?, 'Completed', '#10b981', 9999, 1, ?, ?)",
      ).run(randomUUID(), boardId, at, at);
    }

    // A place to put the first task — and only when the board has NO user lane
    // at all, so someone who deleted `General` on purpose does not find it back
    // the next time they launch.
    const hasUserBlock = db
      .prepare(
        "SELECT 1 FROM blocks WHERE board_id = ? AND is_system = 0 LIMIT 1",
      )
      .get(boardId);
    if (!hasUserBlock) {
      db.prepare(
        "INSERT INTO blocks (id, board_id, name, color, sort_order, is_system, created_at, updated_at) " +
          "VALUES (?, ?, 'General', '#f59e0b', 0, 0, ?, ?)",
      ).run(randomUUID(), boardId, at, at);
    }
  });
}
