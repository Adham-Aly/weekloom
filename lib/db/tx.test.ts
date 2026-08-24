import { describe, expect, it } from "vitest";
import { insertBoard, listBoards } from "@/lib/db/boards";
import { upsertBlock } from "@/lib/db/blocks";
import { getDb } from "@/lib/db/connection";
import { upsertItem } from "@/lib/db/items";
import { upsertSteps } from "@/lib/db/steps";
import { setUpTempDb } from "@/lib/db/test-support";
import { tx } from "@/lib/db/tx";

setUpTempDb();

describe("tx", () => {
  it("returns the callback's value and commits its writes", () => {
    const id = tx(() => insertBoard({ name: "B" }).id);
    expect(listBoards().map((b) => b.id)).toEqual([id]);
  });

  it("rolls every write back when the callback throws", () => {
    expect(() =>
      tx(() => {
        insertBoard({ name: "A" });
        insertBoard({ name: "B" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(listBoards()).toEqual([]);
  });

  it("leaves no transaction open after a rollback", () => {
    // A dangling transaction would silently swallow the NEXT operation's
    // atomicity — and its commit — for the life of the process.
    expect(() =>
      tx(() => {
        throw new Error("boom");
      }),
    ).toThrow();
    expect(getDb().isTransaction).toBe(false);
    expect(() => insertBoard({ name: "after" })).not.toThrow();
    expect(listBoards()).toHaveLength(1);
  });

  it("⚠️ a nested tx JOINS the outer one rather than opening a second", () => {
    // SQLite has no nested transactions, and composite operations are built from
    // primitives that are each a `tx` on their own — `createItemWithSteps` wraps
    // `upsertItem` + `upsertSteps`, and `upsertSteps` is itself a `tx`. Throwing
    // on nesting would make that call a runtime failure on the create-task path.
    const board = insertBoard({ name: "B" });
    const block = upsertBlock({ board_id: board.id, name: "Lane" });

    const steps = tx(() => {
      const item = upsertItem({
        board_id: board.id,
        block_id: block.id,
        title: "T",
        start_date: "2026-08-23",
        duration_days: 2,
      });
      return upsertSteps([
        { item_id: item.id, board_id: board.id, day_offset: 0 },
        { item_id: item.id, board_id: board.id, day_offset: 1 },
      ]);
    });

    expect(steps).toHaveLength(2);
    expect(getDb().isTransaction).toBe(false);
  });

  it("⚠️ the OUTERMOST tx owns the rollback — an inner failure undoes the outer writes too", () => {
    const board = insertBoard({ name: "B" });
    expect(() =>
      tx(() => {
        const item = upsertItem({
          board_id: board.id,
          title: "T",
          start_date: "2026-08-23",
        });
        // The inner `tx` inside `upsertSteps` cannot commit on its own, so this
        // CHECK violation has to take the item with it.
        upsertSteps([{ item_id: item.id, board_id: board.id, day_offset: -1 }]);
      }),
    ).toThrow(/CHECK/i);

    expect(
      getDb().prepare("SELECT count(*) AS n FROM items").get(),
    ).toMatchObject({ n: 0 });
    expect(getDb().isTransaction).toBe(false);
  });
});
