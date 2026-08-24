import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/connection";
import { DbMissingRowError } from "@/lib/db/errors";
import { nowISO } from "@/lib/db/now";
import {
  buildInsert,
  buildPatch,
  encInt,
  encJsonOrNull,
  encText,
  encTextOrNull,
  insertRow,
  toItem,
  type Encoder,
  type SqliteRow,
} from "@/lib/db/rows";
import type { ItemInsert, ItemPatch } from "@/lib/db/types";
import type { Item } from "@/lib/types/database";

const ENCODERS: Readonly<Record<keyof ItemPatch | "board_id", Encoder>> = {
  board_id: encText,
  block_id: encTextOrNull,
  prev_block_id: encTextOrNull,
  deadline_id: encTextOrNull,
  title: encText,
  start_date: encText,
  duration_days: encInt,
  deadline_offset: encInt,
  color: encTextOrNull,
  sort_order: encInt,
  // ⚠️ Stored as TEXT with a `json_valid` CHECK. Nothing queries into it; the
  // row mapper parses it back inside a try/catch.
  recurrence: encJsonOrNull,
};

export function listItemsByBoard(boardId: string): Item[] {
  return getDb()
    .prepare("SELECT * FROM items WHERE board_id = ? ORDER BY sort_order, id")
    .all(boardId)
    .map((r) => toItem(r as SqliteRow));
}

/** Across every board — the home screen counts tasks per board. */
export function listItemsAll(): Item[] {
  return getDb()
    .prepare("SELECT * FROM items ORDER BY board_id, sort_order, id")
    .all()
    .map((r) => toItem(r as SqliteRow));
}

/**
 * Every series item, optionally narrowed to one board. This is what the
 * materializer enumerates at launch.
 */
export function listRecurringItems(boardId?: string): Item[] {
  const db = getDb();
  const rows =
    boardId === undefined
      ? db
          .prepare(
            "SELECT * FROM items WHERE recurrence IS NOT NULL ORDER BY board_id, sort_order, id",
          )
          .all()
      : db
          .prepare(
            "SELECT * FROM items WHERE recurrence IS NOT NULL AND board_id = ? ORDER BY sort_order, id",
          )
          .all(boardId);
  return rows.map((r) => toItem(r as SqliteRow));
}

export function getItem(id: string): Item | null {
  const row = getDb().prepare("SELECT * FROM items WHERE id = ?").get(id);
  return row ? toItem(row as SqliteRow) : null;
}

/**
 * The board an item belongs to, or a throw. Steps inherit their board scope
 * from here — see `blockBoardId` for why it throws rather than returning null.
 */
export function itemBoardId(id: string): string {
  const row = getDb()
    .prepare("SELECT board_id FROM items WHERE id = ?")
    .get(id);
  if (!row) throw new DbMissingRowError(`Item not found: ${id}`);
  return String((row as SqliteRow).board_id);
}

export function upsertItem(row: ItemInsert): Item {
  const at = nowISO();
  const { id, ...rest } = row;
  const fields = buildInsert(rest, ENCODERS, {
    id: id ?? randomUUID(),
    created_at: at,
    updated_at: at,
  });
  return toItem(insertRow(getDb(), "items", fields, { upsert: true }));
}

export function updateItemRow(id: string, patch: ItemPatch): Item | null {
  const db = getDb();
  const { columns, values } = buildPatch(patch, ENCODERS);
  if (columns.length === 0) return getItem(id);
  const sql =
    `UPDATE items SET ${columns.map((c) => `${c} = ?`).join(", ")}, ` +
    "updated_at = ? WHERE id = ? RETURNING *";
  const row = db.prepare(sql).get(...values, nowISO(), id);
  return row ? toItem(row as SqliteRow) : null;
}

/** Deleting an item removes its steps by cascade. */
export function deleteItemRow(id: string): void {
  getDb().prepare("DELETE FROM items WHERE id = ?").run(id);
}
