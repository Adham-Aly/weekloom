import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/connection";
import { nowISO } from "@/lib/db/now";
import {
  buildInsert,
  buildPatch,
  encBool,
  encInt,
  encText,
  encTextOrNull,
  insertRow,
  toBoard,
  type Encoder,
  type SqliteRow,
} from "@/lib/db/rows";
import type { BoardInsert, BoardPatch } from "@/lib/db/types";
import type { Board } from "@/lib/types/database";

const ENCODERS: Readonly<Record<keyof BoardPatch, Encoder>> = {
  name: encText,
  color: encTextOrNull,
  icon: encTextOrNull,
  archived: encBool,
  sort_order: encInt,
};

/**
 * Every board, **archived ones included**.
 *
 * ⚠️ There is no archived-filtering variant and none may be added.
 * `components/boards/board-home.tsx` splits this one array into `active` and
 * `trashed`, so a filtered read would empty the Trash — archiving a board would
 * become an irreversible delete with no route back and no error anywhere.
 * Callers filter; the data layer does not.
 *
 * The `, id` tiebreaker is not decoration: `created_at` is millisecond
 * precision, so two boards made in the same millisecond would otherwise come
 * back in an arbitrary order that changes between reads.
 */
export function listBoards(): Board[] {
  return getDb()
    .prepare("SELECT * FROM boards ORDER BY sort_order, created_at, id")
    .all()
    .map((r) => toBoard(r as SqliteRow));
}

export function getBoard(id: string): Board | null {
  const row = getDb().prepare("SELECT * FROM boards WHERE id = ?").get(id);
  return row ? toBoard(row as SqliteRow) : null;
}

export function insertBoard(row: BoardInsert): Board {
  const at = nowISO();
  const { id, ...rest } = row;
  const fields = buildInsert(rest, ENCODERS, {
    id: id ?? randomUUID(),
    created_at: at,
    updated_at: at,
  });
  return toBoard(insertRow(getDb(), "boards", fields, { upsert: false }));
}

/**
 * Apply a patch and return the landed row, or `null` when no such board exists.
 *
 * Returning `null` rather than throwing is what lets the caller decide: a board
 * that vanished between a render and a rename is a user-facing "Board not
 * found", while the same absence during a bulk sweep is nothing at all.
 */
export function updateBoardRow(id: string, patch: BoardPatch): Board | null {
  const db = getDb();
  const { columns, values } = buildPatch(patch, ENCODERS);
  if (columns.length === 0) return getBoard(id);
  const sql =
    `UPDATE boards SET ${columns.map((c) => `${c} = ?`).join(", ")}, ` +
    "updated_at = ? WHERE id = ? RETURNING *";
  const row = db.prepare(sql).get(...values, nowISO(), id);
  return row ? toBoard(row as SqliteRow) : null;
}

/**
 * Delete a board and, by `ON DELETE CASCADE`, its blocks, items, steps and
 * deadlines. ⚠️ The cascade is only real because `PRAGMA foreign_keys = ON` is
 * set on the one connection (`lib/db/connection.ts`) — without it this leaves
 * every child row behind and reports success.
 *
 * A missing id is a no-op, not an error: deleting something already gone is the
 * outcome the caller wanted.
 */
export function deleteBoardRow(id: string): void {
  getDb().prepare("DELETE FROM boards WHERE id = ?").run(id);
}
