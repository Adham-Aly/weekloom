import { describe, expect, it } from "vitest";
import {
  computeItemBarRange,
  estimatePillWidth,
  greedyPack,
  isoAtOffset,
  parseISODate,
} from "./layout";
import type { Item, Step } from "@/lib/types/database";

describe("parseISODate", () => {
  it("parses YYYY-MM-DD as local midnight", () => {
    const d = parseISODate("2026-05-23");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(23);
    expect(d.getHours()).toBe(0);
  });
});

describe("isoAtOffset", () => {
  it("adds days and returns ISO", () => {
    expect(isoAtOffset("2026-05-23", 0)).toBe("2026-05-23");
    expect(isoAtOffset("2026-05-23", 7)).toBe("2026-05-30");
    expect(isoAtOffset("2026-05-23", -2)).toBe("2026-05-21");
  });
});

describe("estimatePillWidth", () => {
  it("floors at 80 for short labels", () => {
    expect(estimatePillWidth("")).toBe(80);
    expect(estimatePillWidth("x")).toBe(80);
  });
  it("grows for longer labels", () => {
    const w = estimatePillWidth("Some Longer Label");
    expect(w).toBeGreaterThan(80);
  });
});

describe("greedyPack", () => {
  it("returns empty for no items", () => {
    expect(greedyPack([])).toEqual({ rowByKey: new Map(), rowEnds: [] });
  });
  it("packs non-overlapping items into row 0", () => {
    const { rowByKey, rowEnds } = greedyPack([
      { key: "a", left: 0, width: 50 },
      { key: "b", left: 60, width: 50 },
    ]);
    expect(rowByKey.get("a")).toBe(0);
    expect(rowByKey.get("b")).toBe(0);
    expect(rowEnds).toEqual([110]);
  });
  it("pushes overlap onto a new row", () => {
    const { rowByKey } = greedyPack([
      { key: "a", left: 0, width: 100 },
      { key: "b", left: 50, width: 100 }, // overlaps a
      { key: "c", left: 200, width: 50 }, // fits back on row 0
    ]);
    expect(rowByKey.get("a")).toBe(0);
    expect(rowByKey.get("b")).toBe(1);
    expect(rowByKey.get("c")).toBe(0);
  });
  it("honors gap", () => {
    // a ends at 100; with gap=10, b at left=105 can't sit on row 0
    const { rowByKey } = greedyPack(
      [
        { key: "a", left: 0, width: 100 },
        { key: "b", left: 105, width: 50 },
      ],
      10,
    );
    expect(rowByKey.get("a")).toBe(0);
    expect(rowByKey.get("b")).toBe(1);
  });
});

describe("computeItemBarRange", () => {
  const item = {
    id: "i1",
    board_id: "bd",
    block_id: "b",
    title: "Demo",
    color: null,
    deadline_id: null,
    deadline_offset: 3,
    duration_days: 3,
    start_date: "2026-05-23",
    sort_order: 0,
    prev_block_id: null,
    recurrence: null,
    created_at: "",
    updated_at: "",
  } satisfies Item;
  function step(day_offset: number, status: Step["status"] = "todo"): Step {
    return {
      id: `s${day_offset}`,
      board_id: "bd",
      item_id: "i1",
      day_offset,
      label: "",
      notes: null,
      status,
      time_of_day: null,
      duration_min: null,
      detached: false,
      origin_day_offset: null,
      completed_at: null,
      created_at: "",
      updated_at: "",
    };
  }

  it("spans the undone steps", () => {
    const r = computeItemBarRange(
      item,
      [step(0, "done"), step(1), step(2)],
      "2026-05-23",
      30,
    );
    expect(r.visibleStartIdx).toBe(1);
    expect(r.visibleEndIdx).toBe(2);
    expect(r.inRange).toBe(true);
  });
  it("falls back to full duration when nothing is undone", () => {
    const r = computeItemBarRange(
      item,
      [step(0, "done"), step(1, "done"), step(2, "done")],
      "2026-05-23",
      30,
    );
    expect(r.visibleStartIdx).toBe(0);
    expect(r.visibleEndIdx).toBe(2);
  });
  it("clips to the visible window", () => {
    // range start is 5 days BEFORE item start, window is 4 days
    const r = computeItemBarRange(item, [step(0), step(1)], "2026-05-28", 4);
    // item.start_date is 5 days before rangeStart, so itemStartIdx = -5
    // visibleStartIdx clamps to 0
    expect(r.visibleStartIdx).toBe(0);
    expect(r.inRange).toBe(false);
  });
});
