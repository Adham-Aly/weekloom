import { describe, expect, it } from "vitest";
import { listBlocksByBoard, upsertBlock } from "@/lib/db/blocks";
import { insertBoard, listBoards, updateBoardRow } from "@/lib/db/boards";
import { getDb } from "@/lib/db/connection";
import { seedLocalData } from "@/lib/db/rpc/seed";
import { setUpTempDb } from "@/lib/db/test-support";

setUpTempDb();

describe("seedLocalData", () => {
  it("on an empty database creates one board with a Completed lane and a General lane", () => {
    // This is literally "the user opens the application for the first time".
    seedLocalData();

    const boards = listBoards();
    expect(boards).toHaveLength(1);
    expect(boards[0].name).toBe("My Board");

    const blocks = listBlocksByBoard(boards[0].id);
    expect(blocks).toHaveLength(2);

    const completed = blocks.find((b) => b.name === "Completed");
    expect(completed).toMatchObject({
      is_system: true,
      color: "#10b981",
      sort_order: 9999,
    });

    const general = blocks.find((b) => b.name === "General");
    expect(general).toMatchObject({
      is_system: false,
      color: "#f59e0b",
      sort_order: 0,
    });
  });

  it("running twice changes nothing", () => {
    // The guards are WHERE NOT EXISTS predicates, which is what makes this
    // idempotent on EVERY launch rather than only the first.
    seedLocalData();
    const before = getDb().prepare("SELECT * FROM blocks ORDER BY id").all();
    const boardsBefore = listBoards();

    seedLocalData();

    expect(getDb().prepare("SELECT * FROM blocks ORDER BY id").all()).toEqual(
      before,
    );
    expect(listBoards()).toEqual(boardsBefore);
  });

  it("with an existing user lane, no General is added", () => {
    // Someone who deleted `General` on purpose does not find it back.
    const board = insertBoard({ name: "Work" });
    upsertBlock({ board_id: board.id, name: "Reading" });

    seedLocalData();

    const names = listBlocksByBoard(board.id)
      .map((b) => b.name)
      .sort();
    expect(names).toEqual(["Completed", "Reading"]);
  });

  it("with an existing Completed lane, no second one is created", () => {
    // A second would violate the partial unique index, so getting this wrong is
    // a throw on launch rather than a duplicate row.
    const board = insertBoard({ name: "Work" });
    upsertBlock({
      board_id: board.id,
      name: "Completed",
      is_system: true,
      color: "#000000",
    });

    expect(() => seedLocalData()).not.toThrow();

    const completed = listBlocksByBoard(board.id).filter(
      (b) => b.name === "Completed",
    );
    expect(completed).toHaveLength(1);
    // And it was left exactly as the user had it.
    expect(completed[0].color).toBe("#000000");
  });

  it("reuses the earliest board and leaves its name alone", () => {
    const first = insertBoard({ name: "Renamed", sort_order: 0 });
    insertBoard({ name: "Second", sort_order: 1 });

    seedLocalData();

    expect(listBoards()).toHaveLength(2);
    expect(listBoards()[0].name).toBe("Renamed");
    expect(
      listBlocksByBoard(first.id)
        .map((b) => b.name)
        .sort(),
    ).toEqual(["Completed", "General"]);
  });

  it("seeds onto an archived board rather than creating a second one", () => {
    // `listBoards` includes archived boards, and so does the seed's own read:
    // creating a fresh `My Board` beside a board the user had merely trashed
    // would be the same failure as filtering the Trash away.
    const board = insertBoard({ name: "Trashed", archived: true });
    updateBoardRow(board.id, { archived: true });

    seedLocalData();

    expect(listBoards()).toHaveLength(1);
    expect(listBlocksByBoard(board.id)).toHaveLength(2);
  });

  it("creates no items, steps or deadlines", () => {
    // No sample content in somebody's only real board.
    seedLocalData();
    for (const table of ["items", "steps", "deadlines"]) {
      expect(
        getDb().prepare(`SELECT count(*) AS n FROM ${table}`).get(),
      ).toMatchObject({ n: 0 });
    }
  });
});
