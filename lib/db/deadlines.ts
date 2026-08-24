import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/connection";
import { nowISO } from "@/lib/db/now";
import {
  buildInsert,
  encText,
  insertRow,
  toDeadline,
  type Encoder,
  type SqliteRow,
} from "@/lib/db/rows";
import type { DeadlineInsert } from "@/lib/db/types";
import type { Deadline } from "@/lib/types/database";

const ENCODERS: Readonly<
  Record<"board_id" | "name" | "date" | "color", Encoder>
> = {
  board_id: encText,
  name: encText,
  date: encText,
  color: encText,
};

/** Ordered by the date they fall on, which is the order the board draws them in. */
export function listDeadlinesByBoard(boardId: string): Deadline[] {
  return getDb()
    .prepare("SELECT * FROM deadlines WHERE board_id = ? ORDER BY date, id")
    .all(boardId)
    .map((r) => toDeadline(r as SqliteRow));
}

/**
 * ⚠️ There is no `updateDeadlineRow`, and the absence is deliberate: the table
 * has no `updated_at` because a deadline is created and deleted, never
 * versioned. Editing one is a delete and a create.
 */
export function upsertDeadline(row: DeadlineInsert): Deadline {
  const { id, ...rest } = row;
  const fields = buildInsert(rest, ENCODERS, {
    id: id ?? randomUUID(),
    created_at: nowISO(),
  });
  return toDeadline(
    insertRow(getDb(), "deadlines", fields, {
      upsert: true,
      // `created_at` stays as first written; without naming it here the upsert's
      // DO UPDATE would rewrite it on every restore.
      immutable: ["id", "created_at"],
    }),
  );
}

/**
 * Delete a deadline. Items pointing at it keep existing —
 * `items.deadline_id` is `ON DELETE SET NULL`, because removing a milestone
 * must not remove the work that was aimed at it.
 */
export function deleteDeadlineRow(id: string): void {
  getDb().prepare("DELETE FROM deadlines WHERE id = ?").run(id);
}
