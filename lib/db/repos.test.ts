import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  blockBoardId,
  getBlock,
  listBlocksAll,
  listBlocksByBoard,
  upsertBlock,
} from "@/lib/db/blocks";
import { insertBoard } from "@/lib/db/boards";
import {
  deleteDeadlineRow,
  listDeadlinesByBoard,
  upsertDeadline,
} from "@/lib/db/deadlines";
import { DbMissingRowError } from "@/lib/db/errors";
import {
  itemBoardId,
  listItemsAll,
  listItemsByBoard,
  listRecurringItems,
  upsertItem,
} from "@/lib/db/items";
import {
  deleteStepsByIds,
  getStep,
  insertSteps,
  listDoneStepsSince,
  listStepsByBoard,
  listStepsByItem,
  listStepsByItemIds,
  updateStepRow,
  upsertStep,
  upsertSteps,
} from "@/lib/db/steps";
import { setUpTempDb } from "@/lib/db/test-support";
import type { Recurrence } from "@/lib/types/database";

setUpTempDb();

/**
 * The published `lib/db` surface that the named-invariant suites do not reach:
 * the plain reads, the bulk writers, and the scope-derivation throws every
 * action depends on.
 */

const WEEKLY: Recurrence = { days: [1], time: "08:00", durationMin: 30 };

function board(name = "B") {
  return insertBoard({ name });
}

describe("scope derivation", () => {
  it("blockBoardId and itemBoardId return the parent's board", () => {
    const b = board();
    const block = upsertBlock({ board_id: b.id, name: "Lane" });
    const item = upsertItem({
      board_id: b.id,
      block_id: block.id,
      title: "T",
      start_date: "2026-08-23",
    });
    expect(blockBoardId(block.id)).toBe(b.id);
    expect(itemBoardId(item.id)).toBe(b.id);
  });

  it("⚠️ both THROW on a missing parent rather than returning null", () => {
    // A caller that read a missing parent as "no scope" would go on to write a
    // row with whatever board_id the request supplied. The throw is the point.
    expect(() => blockBoardId(randomUUID())).toThrow(DbMissingRowError);
    expect(() => itemBoardId(randomUUID())).toThrow(DbMissingRowError);
  });
});

describe("cross-board reads", () => {
  it("listBlocksAll and listItemsAll span every board; the per-board reads do not", () => {
    const a = board("A");
    const b = board("B");
    upsertBlock({ board_id: a.id, name: "A lane" });
    upsertBlock({ board_id: b.id, name: "B lane" });
    upsertItem({ board_id: a.id, title: "A task", start_date: "2026-08-23" });
    upsertItem({ board_id: b.id, title: "B task", start_date: "2026-08-23" });

    expect(listBlocksAll()).toHaveLength(2);
    expect(listItemsAll()).toHaveLength(2);
    expect(listBlocksByBoard(a.id)).toHaveLength(1);
    expect(listItemsByBoard(b.id).map((i) => i.title)).toEqual(["B task"]);
  });

  it("listBlocksByBoard includes archived lanes", () => {
    // ⚠️ The board renders archived block headers from this array, so filtering
    // here would make archiving a lane look like deleting it.
    const b = board();
    upsertBlock({ board_id: b.id, name: "Live" });
    upsertBlock({ board_id: b.id, name: "Hidden", archived: true });
    expect(
      listBlocksByBoard(b.id)
        .map((x) => x.name)
        .sort(),
    ).toEqual(["Hidden", "Live"]);
  });

  it("listRecurringItems returns only series, and narrows by board", () => {
    const a = board("A");
    const b = board("B");
    upsertItem({ board_id: a.id, title: "plain", start_date: "2026-08-23" });
    const seriesA = upsertItem({
      board_id: a.id,
      title: "series A",
      start_date: "2026-08-23",
      recurrence: WEEKLY,
    });
    upsertItem({
      board_id: b.id,
      title: "series B",
      start_date: "2026-08-23",
      recurrence: WEEKLY,
    });

    expect(listRecurringItems()).toHaveLength(2);
    expect(listRecurringItems(a.id).map((i) => i.id)).toEqual([seriesA.id]);
    expect(listRecurringItems(randomUUID())).toEqual([]);
  });
});

describe("upserts are idempotent on a caller-supplied id", () => {
  it("re-creating a block under its original id updates rather than duplicating", () => {
    // What undo-of-delete does: restore the row with the id the UI still holds.
    const b = board();
    const id = randomUUID();
    upsertBlock({ id, board_id: b.id, name: "Lane", color: "#123456" });
    const again = upsertBlock({ id, board_id: b.id, name: "Renamed" });

    expect(listBlocksByBoard(b.id)).toHaveLength(1);
    expect(again.name).toBe("Renamed");
    // ⚠️ A column the second call said nothing about keeps its value rather than
    // reverting to the schema default.
    expect(again.color).toBe("#123456");
    expect(getBlock(id)?.created_at).toBe(again.created_at);
  });

  it("an upsert leaves created_at as first written and moves updated_at", () => {
    const b = board();
    const id = randomUUID();
    const first = upsertBlock({ id, board_id: b.id, name: "Lane" });
    const second = upsertBlock({ id, board_id: b.id, name: "Lane 2" });
    expect(second.created_at).toBe(first.created_at);
    expect(Date.parse(second.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(first.updated_at),
    );
  });
});

describe("step reads and bulk writers", () => {
  function scaffold() {
    const b = board();
    const item = upsertItem({
      board_id: b.id,
      title: "T",
      start_date: "2026-08-23",
      duration_days: 5,
    });
    return { boardId: b.id, itemId: item.id };
  }

  it("upsertSteps writes them all and returns the landed rows", () => {
    const { boardId, itemId } = scaffold();
    const rows = upsertSteps([
      { item_id: itemId, board_id: boardId, day_offset: 0, label: "a" },
      { item_id: itemId, board_id: boardId, day_offset: 1, label: "b" },
    ]);
    expect(rows.map((r) => r.label)).toEqual(["a", "b"]);
    expect(listStepsByItem(itemId)).toHaveLength(2);
  });

  it("upsertSteps is all-or-nothing", () => {
    const { boardId, itemId } = scaffold();
    expect(() =>
      upsertSteps([
        { item_id: itemId, board_id: boardId, day_offset: 0 },
        // Violates CHECK (day_offset >= 0), so the batch must roll back whole.
        { item_id: itemId, board_id: boardId, day_offset: -1 },
      ]),
    ).toThrow(/CHECK/i);
    expect(listStepsByItem(itemId)).toEqual([]);
  });

  it("insertSteps refuses to overwrite an existing id, where upsertSteps would", () => {
    const { boardId, itemId } = scaffold();
    const id = randomUUID();
    insertSteps([{ id, item_id: itemId, board_id: boardId, day_offset: 0 }]);
    expect(() =>
      insertSteps([{ id, item_id: itemId, board_id: boardId, day_offset: 1 }]),
    ).toThrow(/UNIQUE|PRIMARY KEY/i);
    expect(() =>
      upsertSteps([{ id, item_id: itemId, board_id: boardId, day_offset: 1 }]),
    ).not.toThrow();
    expect(getStep(id)?.day_offset).toBe(1);
  });

  it("both bulk writers accept an empty list without touching the database", () => {
    const { itemId } = scaffold();
    expect(upsertSteps([])).toEqual([]);
    expect(insertSteps([])).toEqual([]);
    expect(listStepsByItem(itemId)).toEqual([]);
  });

  it("listStepsByItemIds gathers several items and short-circuits on none", () => {
    const one = scaffold();
    const two = scaffold();
    upsertStep({ item_id: one.itemId, board_id: one.boardId, day_offset: 0 });
    upsertStep({ item_id: two.itemId, board_id: two.boardId, day_offset: 0 });

    expect(listStepsByItemIds([one.itemId, two.itemId])).toHaveLength(2);
    expect(listStepsByItemIds([one.itemId])).toHaveLength(1);
    // `IN ()` is a syntax error in SQLite, and the honest answer to "steps of no
    // items" is no steps.
    expect(listStepsByItemIds([])).toEqual([]);
  });

  it("listStepsByBoard returns every step on the board", () => {
    const { boardId, itemId } = scaffold();
    upsertSteps([
      { item_id: itemId, board_id: boardId, day_offset: 0 },
      { item_id: itemId, board_id: boardId, day_offset: 1 },
    ]);
    expect(listStepsByBoard(boardId)).toHaveLength(2);
    expect(listStepsByBoard(randomUUID())).toEqual([]);
  });

  it("listDoneStepsSince filters on both status and the cutoff", () => {
    const { boardId, itemId } = scaffold();
    const old = upsertStep({
      item_id: itemId,
      board_id: boardId,
      day_offset: 0,
    });
    const recent = upsertStep({
      item_id: itemId,
      board_id: boardId,
      day_offset: 1,
    });
    const todo = upsertStep({
      item_id: itemId,
      board_id: boardId,
      day_offset: 2,
    });
    updateStepRow(old.id, {
      status: "done",
      completed_at: "2026-01-01T00:00:00.000Z",
    });
    updateStepRow(recent.id, {
      status: "done",
      completed_at: "2026-08-20T00:00:00.000Z",
    });
    // A done step that never recorded when — NULL fails the comparison, which is
    // right: it cannot be placed on the activity grid.
    updateStepRow(todo.id, { status: "done" });

    const since = listDoneStepsSince("2026-06-01T00:00:00.000Z");
    expect(since.map((s) => s.id)).toEqual([recent.id]);
  });

  it("deleteStepsByIds removes exactly the named rows and ignores an empty list", () => {
    const { boardId, itemId } = scaffold();
    const [a, b, c] = upsertSteps([
      { item_id: itemId, board_id: boardId, day_offset: 0 },
      { item_id: itemId, board_id: boardId, day_offset: 1 },
      { item_id: itemId, board_id: boardId, day_offset: 2 },
    ]);
    deleteStepsByIds([]);
    expect(listStepsByItem(itemId)).toHaveLength(3);
    deleteStepsByIds([a.id, c.id]);
    expect(listStepsByItem(itemId).map((s) => s.id)).toEqual([b.id]);
  });

  it("updateStepRow returns null for a deleted id", () => {
    expect(updateStepRow(randomUUID(), { label: "x" })).toBeNull();
  });
});

describe("deadlines", () => {
  it("list by board, ordered by date; upsert restores under its original id", () => {
    const b = board();
    const id = randomUUID();
    upsertDeadline({ board_id: b.id, name: "Later", date: "2026-12-31" });
    const first = upsertDeadline({
      id,
      board_id: b.id,
      name: "Sooner",
      date: "2026-09-01",
      color: "#ff0000",
    });

    expect(listDeadlinesByBoard(b.id).map((d) => d.name)).toEqual([
      "Sooner",
      "Later",
    ]);

    const restored = upsertDeadline({
      id,
      board_id: b.id,
      name: "Sooner",
      date: "2026-09-01",
    });
    expect(listDeadlinesByBoard(b.id)).toHaveLength(2);
    // created_at is immutable across the upsert — a restore is not a re-creation.
    expect(restored.created_at).toBe(first.created_at);
    expect(restored.color).toBe("#ff0000");
  });

  it("deleteDeadlineRow is a no-op on a missing id", () => {
    const b = board();
    upsertDeadline({ board_id: b.id, name: "D", date: "2026-09-01" });
    expect(() => deleteDeadlineRow(randomUUID())).not.toThrow();
    expect(listDeadlinesByBoard(b.id)).toHaveLength(1);
  });
});
