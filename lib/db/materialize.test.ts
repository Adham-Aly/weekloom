import { describe, expect, it, vi } from "vitest";
import { MATERIALIZE_AHEAD_DAYS } from "@/lib/calendar/recurrence";
import { insertBoard } from "@/lib/db/boards";
import { getDb } from "@/lib/db/connection";
import { upsertItem } from "@/lib/db/items";
import { materializeAll } from "@/lib/db/materialize";
import { listStepsByItem, upsertStep } from "@/lib/db/steps";
import { setUpTempDb } from "@/lib/db/test-support";
import type { Item, Recurrence } from "@/lib/types/database";

setUpTempDb();

// 2026-08-24 is a Monday.
const MONDAY = "2026-08-24";
const WEEKLY: Recurrence = { days: [1], time: "08:00", durationMin: 30 };

function weeklySeries(
  boardId: string,
  over: Partial<{ recurrence: Recurrence | null; start_date: string }> = {},
): Item {
  return upsertItem({
    board_id: boardId,
    title: "S",
    start_date: over.start_date ?? MONDAY,
    duration_days: 1,
    recurrence: over.recurrence === undefined ? WEEKLY : over.recurrence,
  });
}

describe("materializeAll", () => {
  it("extends a fresh weekly series to the horizon", () => {
    const board = insertBoard({ name: "B" });
    const item = weeklySeries(board.id);

    const result = materializeAll(MONDAY);

    expect(result.series).toBe(1);
    // Mondays at 0, 7, … up to and including the 56-day horizon.
    const expected = [];
    for (let o = 0; o <= MATERIALIZE_AHEAD_DAYS; o += 7) expected.push(o);
    expect(result.created).toBe(expected.length);
    expect(listStepsByItem(item.id).map((s) => s.day_offset)).toEqual(expected);
    // Every one is a rule occurrence, so every one carries its origin.
    expect(listStepsByItem(item.id).map((s) => s.origin_day_offset)).toEqual(
      expected,
    );
  });

  it("a second call creates nothing", () => {
    const board = insertBoard({ name: "B" });
    const item = weeklySeries(board.id);
    const first = materializeAll(MONDAY);
    const second = materializeAll(MONDAY);
    expect(second).toEqual({ created: 0, series: 0 });
    expect(listStepsByItem(item.id)).toHaveLength(first.created);
  });

  it("ignores a non-recurring item", () => {
    const board = insertBoard({ name: "B" });
    const plain = weeklySeries(board.id, { recurrence: null });
    expect(materializeAll(MONDAY)).toEqual({ created: 0, series: 0 });
    expect(listStepsByItem(plain.id)).toEqual([]);
  });

  it("spans two boards, and narrows to one when asked", () => {
    const a = insertBoard({ name: "A" });
    const b = insertBoard({ name: "B" });
    weeklySeries(a.id);
    weeklySeries(b.id);

    const all = materializeAll(MONDAY);
    expect(all.series).toBe(2);

    // And the narrowing form only touches the board it names.
    const c = insertBoard({ name: "C" });
    const only = weeklySeries(c.id);
    const scoped = materializeAll(MONDAY, c.id);
    expect(scoped.series).toBe(1);
    expect(listStepsByItem(only.id).length).toBeGreaterThan(0);
  });

  it("a series whose until has already passed gets nothing", () => {
    const board = insertBoard({ name: "B" });
    weeklySeries(board.id, {
      recurrence: { ...WEEKLY, until: "2026-08-20" },
    });
    expect(materializeAll(MONDAY)).toEqual({ created: 0, series: 0 });
  });

  it("⚠️ a series that throws does not stop the next one", () => {
    // One wedged series must not freeze every series after it. Without the
    // per-series catch, a single bad row stops every other series extending —
    // permanently, and with nothing saying so.
    const board = insertBoard({ name: "B" });
    const broken = weeklySeries(board.id);
    const healthy = weeklySeries(board.id);

    // Make exactly one series fail inside materializeSeries. Point its board_id
    // at a board that does not exist, with the FK pragma briefly off so the
    // UPDATE lands: every step it then tries to mint violates the foreign key.
    getDb().exec("PRAGMA foreign_keys = OFF");
    getDb()
      .prepare("UPDATE items SET board_id = 'gone' WHERE id = ?")
      .run(broken.id);
    getDb().exec("PRAGMA foreign_keys = ON");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = materializeAll(MONDAY);
      expect(result.series).toBe(1);
      expect(spy).toHaveBeenCalledWith(
        "[db/materialize] series failed",
        expect.objectContaining({ itemId: broken.id }),
      );
    } finally {
      spy.mockRestore();
    }

    expect(listStepsByItem(healthy.id).length).toBeGreaterThan(0);
    // And the failing series rolled back cleanly — no half-materialized rows.
    expect(listStepsByItem(broken.id)).toEqual([]);
  });

  it("resumes past the watermark rather than refilling a vacated slot", () => {
    // The end-to-end form of the origin invariant: an occurrence dragged
    // backwards must not have its old slot refilled.
    const board = insertBoard({ name: "B" });
    const item = weeklySeries(board.id);
    materializeAll(MONDAY);
    const before = listStepsByItem(item.id).length;

    const last = listStepsByItem(item.id).at(-1)!;
    getDb()
      .prepare("UPDATE steps SET day_offset = 1, detached = 1 WHERE id = ?")
      .run(last.id);

    expect(materializeAll(MONDAY)).toEqual({ created: 0, series: 0 });
    expect(listStepsByItem(item.id)).toHaveLength(before);
  });

  it("a manual step far in the future does not freeze the series", () => {
    // A null origin contributes nothing to the watermark. Feeding a manual
    // step's position in would push the watermark past the horizon and the
    // series would never materialize again.
    const board = insertBoard({ name: "B" });
    const item = weeklySeries(board.id);
    upsertStep({ item_id: item.id, board_id: board.id, day_offset: 180 });

    const result = materializeAll(MONDAY);
    expect(result.created).toBeGreaterThan(0);
  });
});
