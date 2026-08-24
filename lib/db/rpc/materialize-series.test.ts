import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { insertBoard } from "@/lib/db/boards";
import { getItem, upsertItem } from "@/lib/db/items";
import { materializeSeries } from "@/lib/db/rpc/materialize-series";
import { listStepsByItem, upsertStep } from "@/lib/db/steps";
import { setUpTempDb } from "@/lib/db/test-support";
import type { Item } from "@/lib/types/database";

setUpTempDb();

function series(duration = 1): Item {
  const board = insertBoard({ name: "B" });
  return upsertItem({
    board_id: board.id,
    title: "S",
    start_date: "2026-08-23",
    duration_days: duration,
    recurrence: { days: [1], time: "08:00", durationMin: 30 },
  });
}

const rule = { time: "08:00", durationMin: 30 };

describe("materializeSeries", () => {
  it("creates one row per missing offset and returns the count", () => {
    const item = series();
    const created = materializeSeries({
      itemId: item.id,
      offsets: [0, 7, 14],
      ...rule,
    });
    expect(created).toBe(3);
    expect(listStepsByItem(item.id).map((s) => s.day_offset)).toEqual([
      0, 7, 14,
    ]);
  });

  it("stamps a new occurrence with origin = day_offset and the rule's fields", () => {
    const item = series();
    materializeSeries({ itemId: item.id, offsets: [7], ...rule });
    const [step] = listStepsByItem(item.id);
    expect(step).toMatchObject({
      day_offset: 7,
      origin_day_offset: 7,
      label: "",
      time_of_day: "08:00",
      duration_min: 30,
      status: "todo",
      detached: false,
    });
  });

  it("a second identical call creates nothing", () => {
    const item = series();
    materializeSeries({ itemId: item.id, offsets: [0, 7], ...rule });
    expect(
      materializeSeries({ itemId: item.id, offsets: [0, 7], ...rule }),
    ).toBe(0);
    expect(listStepsByItem(item.id)).toHaveLength(2);
  });

  it("⚠️ dedups on origin_day_offset, never on day_offset", () => {
    // The user dragged occurrence 7 to day 20. It is STILL occurrence 7, and
    // minting "because nothing sits at day_offset 7" puts a duplicate on top of
    // an occurrence the user deliberately moved.
    const item = series(30);
    upsertStep({
      item_id: item.id,
      board_id: item.board_id,
      day_offset: 20,
      origin_day_offset: 7,
      detached: true,
    });
    expect(materializeSeries({ itemId: item.id, offsets: [7], ...rule })).toBe(
      0,
    );
    expect(listStepsByItem(item.id)).toHaveLength(1);
  });

  it("⚠️ does NOT skip an offset whose day_offset collides but whose origin differs", () => {
    // The mirror of the case above, and the reason position is not the key: a
    // manual step sitting on day 7 is not occurrence 7, so occurrence 7 is still
    // missing and must be minted. Two steps on one day is supported and visible.
    const item = series(30);
    upsertStep({ item_id: item.id, board_id: item.board_id, day_offset: 7 });
    expect(materializeSeries({ itemId: item.id, offsets: [7], ...rule })).toBe(
      1,
    );
    expect(listStepsByItem(item.id)).toHaveLength(2);
  });

  it("⚠️ grows duration_days when the new span is larger", () => {
    const item = series(1);
    materializeSeries({
      itemId: item.id,
      offsets: [0, 7],
      ...rule,
      newDuration: 8,
    });
    expect(getItem(item.id)?.duration_days).toBe(8);
  });

  it("⚠️ does NOT shrink duration_days when the new span is smaller", () => {
    // Shrinking here fights resizeItem, which owns that decision, and orphans
    // every step past the new end.
    const item = series(30);
    materializeSeries({
      itemId: item.id,
      offsets: [0],
      ...rule,
      newDuration: 5,
    });
    expect(getItem(item.id)?.duration_days).toBe(30);
  });

  it("a missing item returns 0 and writes nothing", () => {
    expect(
      materializeSeries({ itemId: randomUUID(), offsets: [0, 7], ...rule }),
    ).toBe(0);
  });

  it("an empty offsets list is a no-op that still honours newDuration", () => {
    const item = series(1);
    expect(
      materializeSeries({
        itemId: item.id,
        offsets: [],
        ...rule,
        newDuration: 9,
      }),
    ).toBe(0);
    expect(getItem(item.id)?.duration_days).toBe(9);
  });

  it("carries a null durationMin through as null", () => {
    const item = series();
    materializeSeries({
      itemId: item.id,
      offsets: [0],
      time: "08:00",
      durationMin: null,
    });
    expect(listStepsByItem(item.id)[0].duration_min).toBeNull();
  });
});
