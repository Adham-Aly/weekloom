import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deleteBlockRow,
  deleteItemsByBlock,
  listBlocksByBoard,
  upsertBlock,
} from "@/lib/db/blocks";
import { getDb } from "@/lib/db/connection";
import { deleteDeadlineRow, upsertDeadline } from "@/lib/db/deadlines";
import { deleteBoardRow, insertBoard } from "@/lib/db/boards";
import {
  deleteItemRow,
  getItem,
  listItemsByBoard,
  upsertItem,
} from "@/lib/db/items";
import { listStepsByItem, upsertStep } from "@/lib/db/steps";
import { setUpTempDb } from "@/lib/db/test-support";

setUpTempDb();

/**
 * ⚠️ These assert the BEHAVIOUR of the foreign keys, never the pragma.
 *
 * `PRAGMA foreign_keys` is per-connection and off by default in SQLite. Reading
 * it back as 1 says the setting took; only a delete that actually removes the
 * children says the cascades are real. That distinction is the whole point of
 * this file: without the pragma, `deleteBoardRow` reports success and orphans
 * every block, item and step on the board.
 */

function count(table: string): number {
  return Number(
    (
      getDb().prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
        n: number;
      }
    ).n,
  );
}

function scaffold() {
  const b = insertBoard({ name: "B" });
  const block = upsertBlock({ board_id: b.id, name: "Lane" });
  const deadline = upsertDeadline({
    board_id: b.id,
    name: "Ship",
    date: "2026-09-01",
  });
  const item = upsertItem({
    board_id: b.id,
    block_id: block.id,
    deadline_id: deadline.id,
    title: "T",
    start_date: "2026-08-23",
  });
  const step = upsertStep({
    item_id: item.id,
    board_id: b.id,
    day_offset: 0,
  });
  return { board: b, block, deadline, item, step };
}

describe("cascades", () => {
  it("deleting a board removes its blocks, items, steps and deadlines", () => {
    const { board } = scaffold();
    deleteBoardRow(board.id);
    expect(count("boards")).toBe(0);
    expect(count("blocks")).toBe(0);
    expect(count("items")).toBe(0);
    expect(count("steps")).toBe(0);
    expect(count("deadlines")).toBe(0);
  });

  it("deleting an item removes its steps", () => {
    const { item } = scaffold();
    deleteItemRow(item.id);
    expect(count("items")).toBe(0);
    expect(count("steps")).toBe(0);
  });

  it("⚠️ deleting a block removes its items and their steps", () => {
    // CASCADE, not SET NULL. Deleting a lane deletes the tasks in it — the
    // opposite reading would leave every task alive with a null block_id, i.e.
    // silently demoted to calendar-only and invisible on the Gantt.
    const { block } = scaffold();
    deleteBlockRow(block.id);
    expect(count("blocks")).toBe(0);
    expect(count("items")).toBe(0);
    expect(count("steps")).toBe(0);
  });

  it("deleting a deadline nulls items.deadline_id and LEAVES the item", () => {
    const { deadline, item } = scaffold();
    deleteDeadlineRow(deadline.id);
    expect(count("deadlines")).toBe(0);
    const after = getItem(item.id);
    expect(after).not.toBeNull();
    expect(after?.deadline_id).toBeNull();
  });

  it("deleting a block referenced by prev_block_id nulls that column only", () => {
    const board = insertBoard({ name: "B" });
    const from = upsertBlock({ board_id: board.id, name: "From" });
    const to = upsertBlock({ board_id: board.id, name: "To" });
    const item = upsertItem({
      board_id: board.id,
      block_id: to.id,
      prev_block_id: from.id,
      title: "T",
      start_date: "2026-08-23",
    });

    deleteBlockRow(from.id);

    const after = getItem(item.id);
    expect(after).not.toBeNull();
    expect(after?.prev_block_id).toBeNull();
    expect(after?.block_id).toBe(to.id);
  });

  it("deleteItemsByBlock then deleteBlockRow leaves no item without a lane", () => {
    const { block, board } = scaffold();
    deleteItemsByBlock(block.id);
    deleteBlockRow(block.id);
    expect(listBlocksByBoard(board.id)).toEqual([]);
    expect(listItemsByBoard(board.id)).toEqual([]);
    expect(
      getDb()
        .prepare("SELECT count(*) AS n FROM items WHERE block_id IS NULL")
        .get(),
    ).toMatchObject({ n: 0 });
  });

  it("refuses a step whose item does not exist", () => {
    // The positive control for this whole file: with the FK pragma off, this
    // insert would succeed and every assertion above would be vacuous.
    const board = insertBoard({ name: "B" });
    expect(() =>
      upsertStep({ item_id: randomUUID(), board_id: board.id, day_offset: 0 }),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("keeps a step's own row when a sibling step is deleted", () => {
    const { item, board } = scaffold();
    const second = upsertStep({
      item_id: item.id,
      board_id: board.id,
      day_offset: 1,
    });
    getDb().prepare("DELETE FROM steps WHERE id = ?").run(second.id);
    expect(listStepsByItem(item.id)).toHaveLength(1);
  });
});
