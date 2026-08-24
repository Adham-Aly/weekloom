import { describe, expect, it } from "vitest";
import { computeShift } from "./shift";
import type { Item, Step } from "@/lib/types/database";

function item(over: Partial<Item> = {}): Item {
  return {
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
    ...over,
  };
}
function step(id: string, day_offset: number): Step {
  return {
    id,
    board_id: "bd",
    item_id: "i1",
    day_offset,
    label: "",
    notes: null,
    status: "todo",
    time_of_day: null,
    duration_min: null,
    completed_at: null,
    detached: false,
    origin_day_offset: null,
    created_at: "",
    updated_at: "",
  };
}

describe("computeShift", () => {
  it("no steps and no deadline → noop", () => {
    const r = computeShift({
      item: item(),
      itemSteps: [],
      movingStepIds: new Set(),
      movingDeadline: false,
      delta: 1,
    });
    expect(r.noop).toBe(true);
  });

  it("shifts a selected step right within range", () => {
    const r = computeShift({
      item: item(),
      itemSteps: [step("a", 0), step("b", 1), step("c", 2)],
      movingStepIds: new Set(["a"]),
      movingDeadline: false,
      delta: 1,
    });
    expect(r.stepUpdates).toEqual([{ id: "a", day_offset: 1 }]);
    expect(r.newStartDate).toBeUndefined();
    expect(r.newDuration).toBeUndefined();
    expect(r.noop).toBe(false);
  });

  it("shifting past day 0 slides the item back instead of clipping", () => {
    const r = computeShift({
      item: item(),
      itemSteps: [step("a", 0), step("b", 1)],
      movingStepIds: new Set(["a"]),
      movingDeadline: false,
      delta: -1,
    });
    // a would land at -1; normalize by +1 shifts everyone right and moves
    // start_date back one day.
    expect(r.newStartDate).toBe("2026-05-22");
    expect(r.stepUpdates).toContainEqual({ id: "b", day_offset: 2 });
    // a goes to 0 — same as its original 0, so no update for it.
    expect(r.stepUpdates).not.toContainEqual({ id: "a", day_offset: 0 });
  });

  it("grows duration when a shift extends past the end", () => {
    const r = computeShift({
      item: item({ duration_days: 3 }),
      itemSteps: [step("a", 0), step("b", 1), step("c", 2)],
      movingStepIds: new Set(["c"]),
      movingDeadline: false,
      delta: 1,
    });
    expect(r.stepUpdates).toEqual([{ id: "c", day_offset: 3 }]);
    expect(r.newDuration).toBe(4);
  });

  it("never shrinks duration", () => {
    const r = computeShift({
      item: item({ duration_days: 10 }),
      itemSteps: [step("a", 0), step("b", 5)],
      movingStepIds: new Set(["b"]),
      movingDeadline: false,
      delta: -1,
    });
    expect(r.newDuration).toBeUndefined();
  });

  it("moves the deadline when included in the selection", () => {
    const r = computeShift({
      item: item({ deadline_offset: 5, duration_days: 3 }),
      itemSteps: [step("a", 0), step("b", 1), step("c", 2)],
      movingStepIds: new Set(),
      movingDeadline: true,
      delta: 1,
    });
    expect(r.newDeadlineOffset).toBe(6);
    expect(r.stepUpdates).toEqual([]);
  });

  it("deadline floor: shifting an effective-floored deadline still advances", () => {
    // stored = 3, max undone step = 5, so effective = max(3,5) = 5.
    // delta=+1 advances from effective → 6.
    const r = computeShift({
      item: item({ deadline_offset: 3, duration_days: 6 }),
      itemSteps: [step("a", 0), step("b", 5)],
      movingStepIds: new Set(),
      movingDeadline: true,
      delta: 1,
    });
    expect(r.newDeadlineOffset).toBe(6);
  });

  it("returns noop when the shift would leave everything unchanged", () => {
    const r = computeShift({
      item: item(),
      itemSteps: [step("a", 0)],
      movingStepIds: new Set(), // nothing moving
      movingDeadline: false,
      delta: 1,
    });
    expect(r.noop).toBe(true);
  });
});
