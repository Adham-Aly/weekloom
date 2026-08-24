import { describe, expect, it } from "vitest";
import { computeBodyDrag, computeLeftPull } from "./body-drag";
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
function step(id: string, day_offset: number, over: Partial<Step> = {}): Step {
  return {
    id,
    board_id: "bd",
    item_id: "i1",
    day_offset,
    label: "",
    notes: null,
    status: "todo",
    time_of_day: null, // null => pending / "TBD"
    duration_min: null,
    completed_at: null,
    detached: false,
    origin_day_offset: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}
// The image's "Drainman Project": 3 things in 3 days, deadline one past the
// last cell. step c is the 12:00 PM (timed) one.
const DRAINMAN = [
  step("a", 0),
  step("b", 1),
  step("c", 2, { time_of_day: "12:00" }),
];

describe("computeBodyDrag (sticky deadline, cells pile at the new start)", () => {
  it("dStart === 0 → noop", () => {
    const r = computeBodyDrag(item(), DRAINMAN, 0);
    expect(r.noop).toBe(true);
    expect(r.exhausted).toBe(false);
  });

  it("State 1 → State 2: drag +1 stacks the first two cells onto the start", () => {
    // [0,1,2] → [0,0,1]: a stays, b collapses onto the start, c slides in by one.
    const r = computeBodyDrag(item({ deadline_offset: 3 }), DRAINMAN, 1);
    expect(r.stepUpdates).toContainEqual({ id: "b", day_offset: 0 });
    expect(r.stepUpdates).toContainEqual({ id: "c", day_offset: 1 });
    expect(r.stepUpdates).not.toContainEqual({ id: "a", day_offset: 0 });
    expect(r.newDeadlineOffset).toBe(2); // abs (+1)+2 = +3, unchanged
    expect(r.exhausted).toBe(false);
  });

  it("State 2 → State 3: another +1 stacks all three on the day before the deadline", () => {
    // start from State 2: [0,0,1], deadline 2.
    const r = computeBodyDrag(
      item({ deadline_offset: 2 }),
      [step("a", 0), step("b", 0), step("c", 1, { time_of_day: "12:00" })],
      1,
    );
    expect(r.stepUpdates).toEqual([{ id: "c", day_offset: 0 }]); // c → 0; a,b already 0
    expect(r.newDeadlineOffset).toBe(1); // all on D−1
  });

  it("State 1 → State 3 in one drag (+2): all three collapse onto one column", () => {
    const r = computeBodyDrag(item({ deadline_offset: 3 }), DRAINMAN, 2);
    expect(r.stepUpdates).toContainEqual({ id: "b", day_offset: 0 });
    expect(r.stepUpdates).toContainEqual({ id: "c", day_offset: 0 });
    expect(r.newDeadlineOffset).toBe(1); // cells on D−1, deadline on D
  });

  it("one more push lands the whole stack ON the deadline (dStart = E)", () => {
    // from State 3: [0,0,0], deadline 1.
    const r = computeBodyDrag(
      item({ deadline_offset: 1 }),
      [step("a", 0), step("b", 0), step("c", 0, { time_of_day: "12:00" })],
      1,
    );
    expect(r.stepUpdates).toEqual([]); // already at 0
    expect(r.newDeadlineOffset).toBe(0); // cells + deadline on column D
    expect(r.exhausted).toBe(false);
  });

  it("pushing past the on-deadline stack is exhausted → caller warns", () => {
    const r = computeBodyDrag(item({ deadline_offset: 3 }), DRAINMAN, 4); // dStart > E
    expect(r.exhausted).toBe(true);
    expect(r.noop).toBe(false);
    expect(r.stepUpdates).toEqual([]);
    expect(r.newStartDate).toBeUndefined();
    expect(r.newDeadlineOffset).toBeUndefined();
  });

  it("the 5-TBD example: drag +4 stacks all five; +5 onto deadline; +6 warns", () => {
    const five = [0, 1, 2, 3, 4].map((o) => step(`s${o}`, o));
    const r4 = computeBodyDrag(
      item({ deadline_offset: 5, duration_days: 5 }),
      five,
      4,
    );
    for (const o of [1, 2, 3, 4]) {
      expect(r4.stepUpdates).toContainEqual({ id: `s${o}`, day_offset: 0 });
    }
    expect(r4.newDeadlineOffset).toBe(1); // all on D−1
    const r6 = computeBodyDrag(
      item({ deadline_offset: 5, duration_days: 5 }),
      five,
      6,
    );
    expect(r6.exhausted).toBe(true); // dStart (6) > E (5)
  });

  it("backward drag slides the task earlier rigidly; deadline frozen", () => {
    const r = computeBodyDrag(item({ deadline_offset: 3 }), DRAINMAN, -2);
    expect(r.stepUpdates).toEqual([]); // offsets unchanged (rigid)
    expect(r.newStartDate).toBe("2026-05-21"); // −2
    expect(r.newDeadlineOffset).toBe(5); // 3 − (−2); abs (−2)+5 = +3, unchanged
  });

  it("timed cells stack like any other (time-of-day preserved)", () => {
    // c is timed; +2 collapses it onto the start with the rest.
    const r = computeBodyDrag(item({ deadline_offset: 3 }), DRAINMAN, 2);
    expect(r.stepUpdates).toContainEqual({ id: "c", day_offset: 0 });
  });

  it("all-done item (no undone steps) just moves start + freezes deadline", () => {
    const r = computeBodyDrag(item({ deadline_offset: 3 }), [], 1);
    expect(r.stepUpdates).toEqual([]);
    expect(r.newStartDate).toBe("2026-05-24"); // +1
    expect(r.newDeadlineOffset).toBe(2); // 3 − 1; abs (+1)+2 = +3, unchanged
    expect(r.exhausted).toBe(false);
  });
});

describe("computeLeftPull (left-edge pull-back un-stacks the staircase)", () => {
  // 5 cells fully stacked one day before the deadline: offsets [0,0,0,0,0],
  // deadline_offset 1 (deadline sits on the next column).
  const stacked = () => [0, 1, 2, 3, 4].map((i) => step(`s${i}`, 0));

  it("dStart >= 0 (shrink-from-left) is a noop here — legacy path handles it", () => {
    expect(
      computeLeftPull(item({ deadline_offset: 1 }), stacked(), 1).noop,
    ).toBe(true);
    expect(
      computeLeftPull(item({ deadline_offset: 1 }), stacked(), 0).noop,
    ).toBe(true);
  });

  it("pull back 1 unfolds one step off the stack", () => {
    const r = computeLeftPull(
      item({ deadline_offset: 1, duration_days: 5 }),
      stacked(),
      -1,
    );
    expect(r.stepUpdates).toEqual([{ id: "s4", day_offset: 1 }]); // [0,0,0,0,1]
    expect(r.addOffsets).toEqual([]);
    expect(r.newDeadlineOffset).toBe(2);
  });

  it("pull back 4 forms the full 5-wide staircase, no new cells", () => {
    const r = computeLeftPull(
      item({ deadline_offset: 1, duration_days: 5 }),
      stacked(),
      -4,
    );
    for (const i of [1, 2, 3, 4]) {
      expect(r.stepUpdates).toContainEqual({ id: `s${i}`, day_offset: i }); // [0,1,2,3,4]
    }
    expect(r.addOffsets).toEqual([]);
    expect(r.newDeadlineOffset).toBe(5);
  });

  it("pull back 5 (beyond the staircase) adds one new TBD cell on the left", () => {
    const r = computeLeftPull(
      item({ deadline_offset: 1, duration_days: 5 }),
      stacked(),
      -5,
    );
    for (const i of [0, 1, 2, 3, 4]) {
      expect(r.stepUpdates).toContainEqual({ id: `s${i}`, day_offset: i + 1 });
    }
    expect(r.addOffsets).toEqual([0]); // one new cell at the far-left column
    expect(r.newDeadlineOffset).toBe(6);
    expect(r.newDuration).toBe(6);
  });

  it("pull back 7 adds three new TBD cells (deadline 8, duration 8)", () => {
    const r = computeLeftPull(
      item({ deadline_offset: 1, duration_days: 5 }),
      stacked(),
      -7,
    );
    expect(r.addOffsets).toEqual([0, 1, 2]);
    for (const i of [0, 1, 2, 3, 4]) {
      expect(r.stepUpdates).toContainEqual({ id: `s${i}`, day_offset: i + 3 });
    }
    expect(r.newDeadlineOffset).toBe(8);
    expect(r.newDuration).toBe(8);
  });

  it("a scheduled (timed) cell lands at the rightmost staircase step", () => {
    const cells = [
      step("a", 0),
      step("t", 0, { time_of_day: "12:00" }),
      step("b", 0),
    ];
    const r = computeLeftPull(
      item({ deadline_offset: 1, duration_days: 3 }),
      cells,
      -2,
    );
    // eNew=3 → staircase [0,1,2]; untimed first (a,b → 0,1), timed last (t → 2).
    expect(r.stepUpdates).toContainEqual({ id: "t", day_offset: 2 });
  });
});
