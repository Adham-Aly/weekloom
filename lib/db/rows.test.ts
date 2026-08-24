import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { upsertBlock, updateBlockRow } from "@/lib/db/blocks";
import { insertBoard, updateBoardRow } from "@/lib/db/boards";
import { getDb } from "@/lib/db/connection";
import { listDeadlinesByBoard, upsertDeadline } from "@/lib/db/deadlines";
import { DbInvalidInputError } from "@/lib/db/errors";
import { getItem, upsertItem } from "@/lib/db/items";
import { bindBool, buildPatch, encInt, encText } from "@/lib/db/rows";
import { getStep, updateStepRow, upsertStep } from "@/lib/db/steps";
import { setUpTempDb } from "@/lib/db/test-support";
import type { StepPatch } from "@/lib/db/types";
import type { Recurrence } from "@/lib/types/database";

setUpTempDb();

const RULE: Recurrence = { days: [1, 3], time: "08:00", durationMin: 30 };

function scaffold() {
  const board = insertBoard({ name: "B" });
  const block = upsertBlock({ board_id: board.id, name: "Lane" });
  const item = upsertItem({
    board_id: board.id,
    block_id: block.id,
    title: "T",
    start_date: "2026-08-23",
  });
  return { board, block, item };
}

describe("booleans survive the round trip as booleans", () => {
  it("a board's archived flag comes back true/false, never 1/0", () => {
    const board = insertBoard({ name: "B", archived: true });
    expect(board.archived).toBe(true);
    expect(insertBoard({ name: "C" }).archived).toBe(false);
  });

  it("⚠️ a block's is_system comes back true — the failure 0/1 would hide", () => {
    // `archived ? …` appears to work with a raw 0/1 because 0 is falsy. But
    // `is_system === true` silently fails against the number 1, so a system lane
    // would render as an ordinary one and `deleteBlock` would agree to remove
    // it. That asymmetry is why the mapper is mandatory rather than tidy.
    const { board } = scaffold();
    const sys = upsertBlock({
      board_id: board.id,
      name: "Completed",
      is_system: true,
      collapsed: true,
    });
    expect(sys.is_system).toBe(true);
    expect(sys.is_system === true).toBe(true);
    expect(sys.collapsed).toBe(true);
  });

  it("a step's detached flag comes back boolean", () => {
    const { board, item } = scaffold();
    const step = upsertStep({
      item_id: item.id,
      board_id: board.id,
      day_offset: 0,
      detached: true,
    });
    expect(step.detached).toBe(true);
    expect(getStep(step.id)?.detached).toBe(true);
  });

  it("bindBool converts, and a raw boolean never reaches a bind site", () => {
    expect(bindBool(true)).toBe(1);
    expect(bindBool(false)).toBe(0);
    // The measured failure this guards: node:sqlite throws on a bound boolean.
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO boards (id, name, archived, created_at, updated_at) VALUES (?, 'B', ?, ?, ?)",
        )
        // @ts-expect-error — a boolean is not an SQLInputValue, which is the
        // compile-time half of the same guarantee this line proves at runtime.
        .run(randomUUID(), true, "t", "t"),
    ).toThrow(/cannot be bound/i);
  });
});

describe("values survive without being reinterpreted", () => {
  it("recurrence round-trips as an object", () => {
    const { board } = scaffold();
    const item = upsertItem({
      board_id: board.id,
      title: "S",
      start_date: "2026-08-23",
      recurrence: RULE,
    });
    expect(item.recurrence).toEqual(RULE);
    expect(getItem(item.id)?.recurrence).toEqual(RULE);
  });

  it("a malformed recurrence yields null and logs rather than throwing", () => {
    // One bad row must not make a whole board unrenderable.
    const { board } = scaffold();
    const id = randomUUID();
    getDb()
      .prepare(
        "INSERT INTO items (id, board_id, title, start_date, recurrence, created_at, updated_at) " +
          "VALUES (?, ?, 'S', '2026-08-23', '[1,2]', 't', 't')",
      )
      .run(id, board.id);
    // Valid JSON (so the CHECK passes) but not a rule object — JSON.parse gives
    // an array, which is what a hand-edited file produces.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const row = getItem(id);
      expect(row).not.toBeNull();
      // Parsing successfully is not the same as having a rule: an array would
      // reach the materializer with `days` undefined. Null, and say so.
      expect(row?.recurrence).toBeNull();
      expect(spy).toHaveBeenCalledWith("[db] recurrence is not a rule object", {
        itemId: id,
      });
    } finally {
      spy.mockRestore();
    }

    const broken = randomUUID();
    getDb()
      .prepare(
        "INSERT INTO items (id, board_id, title, start_date, created_at, updated_at) " +
          "VALUES (?, ?, 'S', '2026-08-23', 't', 't')",
      )
      .run(broken, board.id);
    // Bypass the CHECK the only way a real corruption would: rewrite the file
    // outside the app. `PRAGMA ignore_check_constraints` is the in-process
    // equivalent.
    getDb().exec("PRAGMA ignore_check_constraints = ON");
    getDb()
      .prepare("UPDATE items SET recurrence = 'not json' WHERE id = ?")
      .run(broken);
    getDb().exec("PRAGMA ignore_check_constraints = OFF");

    const spy2 = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(getItem(broken)?.recurrence).toBeNull();
      expect(spy2).toHaveBeenCalledWith("[db] unparseable recurrence", {
        itemId: broken,
      });
    } finally {
      spy2.mockRestore();
    }
  });

  it("time_of_day survives as a floating local wall clock", () => {
    // ⚠️ Never round-tripped through `new Date()`. '09:30' is 09:30 wherever
    // the laptop is, and a UTC normalisation would move it by the offset.
    const { board, item } = scaffold();
    const step = upsertStep({
      item_id: item.id,
      board_id: board.id,
      day_offset: 0,
      time_of_day: "09:30",
    });
    expect(step.time_of_day).toBe("09:30");
    expect(getStep(step.id)?.time_of_day).toBe("09:30");
  });

  it("start_date and a deadline date survive as floating local dates", () => {
    const { board, item } = scaffold();
    expect(item.start_date).toBe("2026-08-23");
    upsertDeadline({ board_id: board.id, name: "D", date: "2026-12-31" });
    expect(listDeadlinesByBoard(board.id)[0].date).toBe("2026-12-31");
  });

  it("a mapped row is a plain object — it survives JSON.stringify", () => {
    // DatabaseSync returns null-prototype objects. A fresh literal is also what
    // makes a row safe to hand to a Server Component as a prop.
    const board = insertBoard({ name: "B" });
    expect(Object.getPrototypeOf(board)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(board))).toEqual(board);
  });

  it("a null origin_day_offset stays null, never 0", () => {
    const { board, item } = scaffold();
    const step = upsertStep({
      item_id: item.id,
      board_id: board.id,
      day_offset: 4,
    });
    expect(step.origin_day_offset).toBeNull();
  });
});

describe("patches bind only the columns they name", () => {
  it("⚠️ updateBlockRow with one key writes one column, not eleven", () => {
    // The measured failure: binding `undefined` throws exactly as binding a
    // boolean does. A `Partial<Row>` therefore has to produce a SHORTER
    // statement, never a longer one with holes in it.
    const { board } = scaffold();
    const block = upsertBlock({
      board_id: board.id,
      name: "Lane",
      color: "#123456",
      icon: "Briefcase",
      sort_order: 7,
    });
    const after = updateBlockRow(block.id, { name: "Renamed" });
    expect(after?.name).toBe("Renamed");
    expect(after?.color).toBe("#123456");
    expect(after?.icon).toBe("Briefcase");
    expect(after?.sort_order).toBe(7);
  });

  it("a key present with an undefined value is dropped, not bound", () => {
    const { board } = scaffold();
    const block = upsertBlock({ board_id: board.id, name: "Lane" });
    // The shape a spread of optional fields produces.
    const patch = { name: "Renamed", color: undefined };
    expect(() => updateBlockRow(block.id, patch)).not.toThrow();
    expect(updateBlockRow(block.id, {})?.name).toBe("Renamed");
  });

  it("an explicit null IS bound — clearing a column is not the same as omitting it", () => {
    const { board } = scaffold();
    const block = upsertBlock({
      board_id: board.id,
      name: "Lane",
      icon: "Briefcase",
    });
    expect(updateBlockRow(block.id, { icon: null })?.icon).toBeNull();
  });

  it("a patch naming a column that does not exist throws rather than being ignored", () => {
    const { board, item } = scaffold();
    const step = upsertStep({
      item_id: item.id,
      board_id: board.id,
      day_offset: 0,
    });
    // Silently dropping a column the caller asked to write is the shape of bug
    // where a setting "doesn't do anything". The extra key is attached at
    // runtime because the type system already refuses it at compile time —
    // which is the other half of the same guarantee.
    const patch: StepPatch = { label: "x" };
    (patch as Record<string, unknown>).nonsense = 1;
    expect(() => updateStepRow(step.id, patch)).toThrow(DbInvalidInputError);
  });

  it("buildPatch omits undefined and encodes what remains", () => {
    const { columns, values } = buildPatch(
      { name: "x", sort_order: undefined },
      { name: encText, sort_order: encInt },
    );
    expect(columns).toEqual(["name"]);
    expect(values).toEqual(["x"]);
  });

  it("updateBoardRow with an empty patch reads rather than writes", () => {
    const board = insertBoard({ name: "B" });
    const after = updateBoardRow(board.id, {});
    expect(after).toEqual(board);
  });
});
