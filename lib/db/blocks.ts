import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/connection";
import { DbMissingRowError } from "@/lib/db/errors";
import { nowISO } from "@/lib/db/now";
import {
  buildInsert,
  buildPatch,
  encBool,
  encInt,
  encText,
  encTextOrNull,
  insertRow,
  toBlock,
  type Encoder,
  type SqliteRow,
} from "@/lib/db/rows";
import type { BlockInsert, BlockPatch } from "@/lib/db/types";
import type { Block } from "@/lib/types/database";

const ENCODERS: Readonly<
  Record<keyof BlockPatch | "board_id" | "is_system", Encoder>
> = {
  board_id: encText,
  name: encText,
  color: encText,
  sort_order: encInt,
  collapsed: encBool,
  is_system: encBool,
  icon: encTextOrNull,
  archived: encBool,
};

/**
 * Every block on a board, **archived ones included**.
 *
 * ⚠️ Same rule as `listBoards`: the board renders archived block headers from
 * this array, so filtering here would make archiving a lane look like deleting
 * it. Note that the `*All` suffix elsewhere in this module means "across every
 * board", never "including archived".
 */
export function listBlocksByBoard(boardId: string): Block[] {
  return getDb()
    .prepare("SELECT * FROM blocks WHERE board_id = ? ORDER BY sort_order, id")
    .all(boardId)
    .map((r) => toBlock(r as SqliteRow));
}

/** Across every board — the home screen's per-board statistics need all of them. */
export function listBlocksAll(): Block[] {
  return getDb()
    .prepare("SELECT * FROM blocks ORDER BY board_id, sort_order, id")
    .all()
    .map((r) => toBlock(r as SqliteRow));
}

export function getBlock(id: string): Block | null {
  const row = getDb().prepare("SELECT * FROM blocks WHERE id = ?").get(id);
  return row ? toBlock(row as SqliteRow) : null;
}

/**
 * The board a block belongs to, or a throw.
 *
 * This is the scope derivation items and steps inherit: a step's board is its
 * item's board, an item's board is its lane's board, and none of the three is
 * ever taken from the caller. ⚠️ The throw is the point — a caller that reads a
 * missing block as "no scope" would go on to write a row with whatever
 * `board_id` the request supplied.
 */
export function blockBoardId(id: string): string {
  const row = getDb()
    .prepare("SELECT board_id FROM blocks WHERE id = ?")
    .get(id);
  if (!row) throw new DbMissingRowError(`Block not found: ${id}`);
  return String((row as SqliteRow).board_id);
}

/**
 * Insert a block, or update it in place when its id already exists.
 *
 * The upsert is what makes undo-of-delete work: the restore re-creates the row
 * under its original id, and a repeated restore lands the same row rather than
 * failing on the primary key.
 */
export function upsertBlock(row: BlockInsert): Block {
  const at = nowISO();
  const { id, ...rest } = row;
  const fields = buildInsert(rest, ENCODERS, {
    id: id ?? randomUUID(),
    created_at: at,
    updated_at: at,
  });
  return toBlock(insertRow(getDb(), "blocks", fields, { upsert: true }));
}

export function updateBlockRow(id: string, patch: BlockPatch): Block | null {
  const db = getDb();
  const { columns, values } = buildPatch(patch, ENCODERS);
  if (columns.length === 0) return getBlock(id);
  const sql =
    `UPDATE blocks SET ${columns.map((c) => `${c} = ?`).join(", ")}, ` +
    "updated_at = ? WHERE id = ? RETURNING *";
  const row = db.prepare(sql).get(...values, nowISO(), id);
  return row ? toBlock(row as SqliteRow) : null;
}

export function deleteBlockRow(id: string): void {
  getDb().prepare("DELETE FROM blocks WHERE id = ?").run(id);
}

/**
 * Delete every item in a block (and, by cascade, their steps).
 *
 * ⚠️ Callers run this **before** `deleteBlockRow`. `items.block_id` is
 * `ON DELETE CASCADE`, so the ordering is belt-and-braces rather than
 * load-bearing — but the cascade itself is only real while
 * `PRAGMA foreign_keys = ON` holds on the connection, and that pragma is
 * per-connection and off by default in SQLite. Doing it explicitly means a lost
 * pragma costs a leftover row rather than an entire board of orphans.
 */
export function deleteItemsByBlock(blockId: string): void {
  getDb().prepare("DELETE FROM items WHERE block_id = ?").run(blockId);
}
