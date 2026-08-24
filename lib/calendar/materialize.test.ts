import { describe, expect, it } from "vitest";
import {
  originOffsetOf,
  planMaterialization,
  type MaterializableItem,
  type MaterializableStep,
} from "./materialize";
import type { Recurrence } from "@/lib/types/database";

// 2026-07-13 is a Monday (getDay() === 1).
const MONDAY = "2026-07-13";

const rule = (days: number[], until?: string): Recurrence => ({
  days,
  time: "08:00",
  durationMin: 30,
  ...(until ? { until } : {}),
});

const item = (over: Partial<MaterializableItem> = {}): MaterializableItem => ({
  id: "item-1",
  start_date: MONDAY,
  duration_days: 1,
  recurrence: rule([1]), // Mondays
  ...over,
});

/** A rule-generated occurrence sitting where the rule put it. */
const at = (offset: number): MaterializableStep => ({
  day_offset: offset,
  origin_day_offset: offset,
});

/** An occurrence the user dragged: position moved, origin frozen. */
const dragged = (origin: number, to: number): MaterializableStep => ({
  day_offset: to,
  origin_day_offset: origin,
});

/** A manual step (addStepAt / resizeItem): a real row, but not an occurrence. */
const manual = (offset: number): MaterializableStep => ({
  day_offset: offset,
  origin_day_offset: null,
});

describe("originOffsetOf", () => {
  it("reports where the rule put an occurrence", () => {
    expect(originOffsetOf(dragged(7, 9))).toBe(7);
  });

  it("reports the frozen origin even when the step is NOT detached", () => {
    // The arrow-shift's shape: the RPC froze origin (ruleDelta: 0) and nothing
    // set `detached`. Reading day_offset here would discard that freeze.
    expect(originOffsetOf({ day_offset: 15, origin_day_offset: 21 })).toBe(21);
  });

  it("reports null for a manual step — it is not an occurrence", () => {
    // No `?? day_offset` fallback. Feeding a manual step's position into the
    // watermark silently skips real occurrences (see the freeze tests below).
    expect(originOffsetOf(manual(12))).toBeNull();
  });
});

describe("planMaterialization", () => {
  it("does nothing for a non-recurring item", () => {
    expect(
      planMaterialization(item({ recurrence: null }), [], MONDAY, 14),
    ).toEqual({ offsets: [], newDuration: null });
  });

  it("materializes a fresh series from the start", () => {
    const plan = planMaterialization(item(), [], MONDAY, 21);
    expect(plan.offsets).toEqual([0, 7, 14, 21]);
    expect(plan.newDuration).toBe(22);
  });

  it("resumes past the watermark rather than re-listing", () => {
    const plan = planMaterialization(item(), [at(0), at(7)], MONDAY, 21);
    expect(plan.offsets).toEqual([14, 21]);
  });

  it("grows duration only when the series outruns it", () => {
    const plan = planMaterialization(
      item({ duration_days: 999 }),
      [at(0)],
      MONDAY,
      21,
    );
    expect(plan.offsets).toEqual([7, 14, 21]);
    expect(plan.newDuration).toBeNull();
  });

  it("respects the rule's until", () => {
    const plan = planMaterialization(
      item({ recurrence: rule([1], "2026-07-27") }),
      [],
      MONDAY,
      56,
    );
    expect(plan.offsets).toEqual([0, 7, 14]);
  });

  it("extends relative to today, not to the series start", () => {
    // Series began 14 days ago; today is 2026-07-27, horizon 7 days.
    // targetOffset = 14 + 7 = 21.
    const plan = planMaterialization(
      item(),
      [at(0), at(7), at(14)],
      "2026-07-27",
      7,
    );
    expect(plan.offsets).toEqual([21]);
  });

  // ─── The two failures a position-keyed watermark cannot avoid ─────────
  //
  // Both are about the watermark, and both are why `origin_day_offset` exists.

  it("does NOT refill a slot the user vacated by dragging the last occurrence back", () => {
    // The live bug today: the client's watermark is max(day_offset). Drag the
    // furthest occurrence (offset 21) back to 15 and that watermark drops to
    // 15, so 21 looks unmaterialized and gets refilled — a duplicate landing on
    // a day the user deliberately emptied. Measuring origin instead keeps the
    // watermark at 21.
    const steps = [at(0), at(7), at(14), dragged(21, 15)];

    expect(Math.max(...steps.map((s) => s.day_offset))).toBe(15); // the old, wrong watermark
    const plan = planMaterialization(item(), steps, MONDAY, 21);
    expect(plan.offsets).not.toContain(21);
    expect(plan.offsets).toEqual([]);
  });

  it("still mints a genuinely new occurrence after a drag", () => {
    // The mirror of the above: the watermark must not be so sticky that it
    // suppresses real work. Offset 28 is beyond every origin, so it is new.
    const plan = planMaterialization(
      item(),
      [at(0), at(7), at(14), dragged(21, 15)],
      MONDAY,
      28,
    );
    expect(plan.offsets).toEqual([28]);
  });

  it("does not silently skip an occurrence after an item rebase", () => {
    // The second one. `applyItemMove` rebases start_date and
    // every day_offset together, so a step created at offset 0 can sit at
    // offset 3. With origin rebased alongside (the invariant), origin-space and
    // position-space stay aligned and the next occurrence is minted normally
    // rather than colliding with a stale key.
    //
    // Series rebased 3 days earlier: start_date 07-10 (a Friday), and the
    // Monday rule now fires at offsets 3, 10, 17.
    const rebased = item({ start_date: "2026-07-10", duration_days: 11 });
    const steps = [at(3), at(10)];
    const plan = planMaterialization(rebased, steps, "2026-07-10", 17);
    expect(plan.offsets).toEqual([17]);
  });

  it("never proposes to fill a gap left by a deleted occurrence", () => {
    // A gap is user intent (a deleted occurrence) and is indistinguishable from
    // one by construction. Only offsets past the watermark are ever proposed.
    const plan = planMaterialization(item(), [at(0), at(21)], MONDAY, 21);
    expect(plan.offsets).toEqual([]);
  });

  // ─── A manual step must not move the watermark ─────────────────────────
  //
  // These three were bugs: `origin_day_offset ?? day_offset` fed non-occurrence
  // rows into the watermark. A manual step and a rule step on the same day is a
  // supported, VISIBLE double-up (it's why `unique(item_id, day_offset)` is
  // illegal); the fallback traded that for a SILENT skip.

  it("does not skip occurrences because a manual step sits past them", () => {
    // addStepAt at offset 14 used to set the watermark to 14, silently losing
    // the genuine Monday at offset 7.
    const plan = planMaterialization(item(), [at(0), manual(14)], MONDAY, 21);
    expect(plan.offsets).toEqual([7, 14, 21]);
  });

  it("⚠️ one far-future manual step does not freeze the series forever", () => {
    // The failure this module exists to fix, reintroduced by the fallback: a
    // manual step at day_offset 180 (the schema caps day_offset at 3650, so
    // this is unremarkable) pushed the watermark past the horizon, and
    // occurrenceOffsets(lo=181, hi=56) returns [] — for every future run.
    const plan = planMaterialization(item(), [at(0), manual(180)], MONDAY, 56);
    expect(plan.offsets).toEqual([7, 14, 21, 28, 35, 42, 49, 56]);
  });

  it("a resizeItem tail row does not stop the series extending", () => {
    // resizeItem's grow path inserts tail rows naming no
    // origin_day_offset. Resizing a recurring item must not kill its series.
    const plan = planMaterialization(item(), [at(0), manual(29)], MONDAY, 21);
    expect(plan.offsets).toEqual([7, 14, 21]);
  });

  it('a scope-"all" rotation does not mint a duplicate on top of a moved step', () => {
    // The rotation routes through applyItemMove({ ruleDelta: dayDelta }), and
    // the RPC shifts origin_day_offset by exactly that — so origin moves WITH
    // the rule and is never left in the old coordinate system.
    //
    // Monday series rotated +1 to Tuesday: positions AND origins both 1,...,57.
    const rotated = item({ recurrence: rule([2]), duration_days: 58 });
    const steps: MaterializableStep[] = [0, 7, 14, 21, 28, 35, 42, 49, 56].map(
      (o) => ({ day_offset: o + 1, origin_day_offset: o + 1 }),
    );
    const plan = planMaterialization(rotated, steps, MONDAY, 64);
    expect(plan.offsets).not.toContain(57); // a step is already there
    expect(plan.offsets).toEqual([64]);
  });

  it("⚠️ an arrow-shift does NOT refill the slot the user vacated", () => {
    // F21, and the bug the `detached ? origin : day_offset` fork introduced.
    //
    // shift.ts sends `ruleDelta: 0`, so the RPC correctly FREEZES origin — but
    // shift.ts never touches `detached`, so the step stays detached:false. The
    // fork then read the moved day_offset and threw the freeze away: watermark
    // 21 -> 15, and offset 21 got refilled the next time the series
    // materialized. Reading origin honours the freeze the RPC performed.
    const steps: MaterializableStep[] = [
      { day_offset: 0, origin_day_offset: 0 },
      { day_offset: 7, origin_day_offset: 7 },
      { day_offset: 14, origin_day_offset: 14 },
      // arrow-shifted 21 -> 15; origin frozen at 21 by ruleDelta: 0
      { day_offset: 15, origin_day_offset: 21 },
    ];
    const plan = planMaterialization(item(), steps, MONDAY, 21);
    expect(plan.offsets).not.toContain(21);
    expect(plan.offsets).toEqual([]);
  });

  it("swap_steps can't move the watermark — origin is untouched by a swap", () => {
    // F20, subsumed. swap_steps swaps day_offset and touches neither origin nor
    // detached, so reading origin is immune to it — no cross-agent fix needed.
    const steps: MaterializableStep[] = [
      { day_offset: 0, origin_day_offset: 0 },
      { day_offset: 50, origin_day_offset: 7 }, // swapped
      { day_offset: 7, origin_day_offset: 14 },
    ];
    const plan = planMaterialization(item(), steps, MONDAY, 56);
    // Watermark is max(origin) = 14, so the real occurrences still get minted.
    expect(plan.offsets).toEqual([21, 28, 35, 42, 49, 56]);
  });

  it("a detached step still pins its vacated slot after a rotation", () => {
    // The one job origin_day_offset keeps: the user pinned this occurrence, so
    // its original slot must not be refilled.
    const plan = planMaterialization(
      item(),
      [at(0), at(7), dragged(14, 3)],
      MONDAY,
      14,
    );
    expect(plan.offsets).toEqual([]);
  });

  it("refuses to materialize when the origin_day_offset column is absent", () => {
    // A hand-assembled row that omits the key yields `undefined`, not `null`.
    // Silently falling back to day_offset would restore the mutable watermark —
    // the exact bug this column exists to end. Fail loudly instead.
    const row: Record<string, unknown> = { day_offset: 0 };
    expect(() =>
      planMaterialization(item(), [row as MaterializableStep], MONDAY, 21),
    ).toThrow(/origin_day_offset is missing/);
  });
});
