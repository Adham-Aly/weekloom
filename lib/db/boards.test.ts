import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deleteBoardRow,
  getBoard,
  insertBoard,
  listBoards,
  updateBoardRow,
} from "@/lib/db/boards";
import { getDb } from "@/lib/db/connection";
import { setUpTempDb } from "@/lib/db/test-support";

setUpTempDb();

/**
 * ⚠️ This file exists because nothing else covers archive and restore, and a
 * `listBoards()` that filtered archived rows would break it *silently*: the
 * board picker would look correct, the Trash would simply be empty forever and
 * archiving would have become an irreversible delete.
 */

describe("listBoards", () => {
  it("returns archived boards as well as active ones", () => {
    const active = insertBoard({ name: "Active" });
    const trashed = insertBoard({ name: "Trashed", archived: true });
    const ids = listBoards().map((b) => b.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(trashed.id);
  });

  it("orders by sort_order, then created_at, then id — stably across calls", () => {
    // Same created_at on purpose: `nowISO()` is millisecond precision, so a real
    // burst of creates ties routinely. Without the `, id` tiebreaker the order
    // would be whatever the query planner felt like and could differ per call.
    const at = "2026-08-23T12:00:00.000Z";
    const ids = ["c", "a", "b"].map(() => randomUUID()).sort();
    const insert = getDb().prepare(
      "INSERT INTO boards (id, name, sort_order, created_at, updated_at) VALUES (?, 'B', 0, ?, ?)",
    );
    for (const id of [ids[2], ids[0], ids[1]]) insert.run(id, at, at);

    const first = listBoards().map((b) => b.id);
    const second = listBoards().map((b) => b.id);
    expect(first).toEqual(ids);
    expect(second).toEqual(first);
  });

  it("puts a lower sort_order first regardless of creation order", () => {
    const late = insertBoard({ name: "Late", sort_order: 0 });
    const early = insertBoard({ name: "Early", sort_order: 5 });
    const ids = listBoards().map((b) => b.id);
    expect(ids.indexOf(late.id)).toBeLessThan(ids.indexOf(early.id));
  });
});

describe("updateBoardRow", () => {
  it("archiving keeps the board in listBoards and restoring brings it back", () => {
    const board = insertBoard({ name: "B" });

    const archived = updateBoardRow(board.id, { archived: true });
    expect(archived?.archived).toBe(true);
    expect(listBoards().map((b) => b.id)).toContain(board.id);

    const restored = updateBoardRow(board.id, { archived: false });
    expect(restored?.archived).toBe(false);
    expect(getBoard(board.id)?.archived).toBe(false);
  });

  it("returns null for a missing id rather than throwing", () => {
    expect(updateBoardRow(randomUUID(), { name: "x" })).toBeNull();
  });

  it("bumps updated_at and leaves created_at alone", () => {
    const board = insertBoard({ name: "B" });
    const after = updateBoardRow(board.id, { name: "Renamed" });
    expect(after?.name).toBe("Renamed");
    expect(after?.created_at).toBe(board.created_at);
    expect(Date.parse(after!.updated_at) >= Date.parse(board.updated_at)).toBe(
      true,
    );
  });
});

describe("deleteBoardRow", () => {
  it("is a no-op on a missing id", () => {
    const board = insertBoard({ name: "B" });
    expect(() => deleteBoardRow(randomUUID())).not.toThrow();
    expect(listBoards().map((b) => b.id)).toEqual([board.id]);
  });
});
