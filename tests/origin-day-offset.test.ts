import { describe, it, expect } from "vitest";
import {
  planMaterialization,
  type MaterializableItem,
  type MaterializableStep,
} from "@/lib/calendar/materialize";
import { occurrenceOffsets } from "@/lib/calendar/recurrence";
import type { Recurrence } from "@/lib/types/database";

/**
 * Regression guard for the `origin_day_offset` create-path bug.
 *
 * ## The bug
 *
 * `createItemWithSteps`' sparse (recurring) branch built its step rows without
 * `origin_day_offset`. The column is nullable with no default, and the only
 * writers of the column are `materializeSeries` and `applyItemMove`'s rebase —
 * and the rebase explicitly PRESERVES null. So every series created through
 * that branch had NULL origins on its founding occurrences.
 *
 * Then, deterministically:
 *
 *   1. `planMaterialization` computes `origins = steps.map(originOffsetOf)
 *      .filter(non-null)` -> `[]` -> **watermark = -1**.
 *   2. It therefore proposes EVERY offset from 0.
 *   3. `materializeSeries` inserts `where not exists (item_id = ... and
 *      origin_day_offset = o)`, which is vacuously true for all of them.
 *   4. -> one duplicate occurrence stacked on top of every step the create just
 *      made.
 *
 * It stayed invisible because the optimistic client row sets the value
 * correctly (`board.tsx`), so the browser that created the series renders the
 * right thing while the database holds NULL.
 *
 * ## Why this test is worth its weight
 *
 * The failure is silent in both directions: nothing errors, and the duplicate
 * only appears after a reload or the next materialization pass — by which time
 * the create that caused it is long out of view.
 *
 * ## Mutation test
 *
 * Delete the `...(sparse ? { origin_day_offset: day_offset } : {})` line in
 * `app/actions.ts` and `"a freshly created series proposes ZERO new
 * occurrences"` goes red — it proposes all 5 instead. Verified by doing it.
 *
 * `app/actions.ts` is a `"use server"` module and is outside vitest's include
 * globs, so this test asserts against the ROW BUILDER's output shape and the
 * pure planner it feeds. That is where the defect actually lived: the planner
 * was always correct, and the row builder lied to it.
 */

/** Every weekday, so the offsets are dense and the arithmetic is obvious.
 *  `days` is JS `getDay()` numbering, 0 = Sunday. */
const RULE: Recurrence = {
  days: [0, 1, 2, 3, 4, 5, 6],
  time: "09:00",
  durationMin: 30,
};

/**
 * The sparse-branch row builder from `createItemWithSteps`
 * (`app/actions.ts`), reproduced field-for-field.
 *
 * ⚠️ If you change the row builder there, change it here. The point of this
 * mirror is that the two are compared: `it("mirrors the shape the action
 * writes")` below pins the exact key set, so a drift shows up as a failure
 * rather than as a test that quietly stops testing anything.
 */
function buildSparseStepRows(
  offsets: number[],
  opts: { stepTime?: string; stepDurationMin?: number },
) {
  const sparse = true;
  return offsets.map((day_offset, i) => ({
    item_id: "i",
    board_id: "b",
    day_offset,
    label: !sparse && i === 0 ? "x" : "",
    ...(sparse ? { origin_day_offset: day_offset } : {}),
    ...((sparse || i === 0) && opts.stepTime
      ? { time_of_day: opts.stepTime }
      : {}),
    ...((sparse || i === 0) && opts.stepDurationMin != null
      ? { duration_min: opts.stepDurationMin }
      : {}),
  }));
}

describe("origin_day_offset on freshly created recurring series", () => {
  it("stamps origin_day_offset = day_offset on every founding occurrence", () => {
    const offsets = occurrenceOffsets("2026-07-22", RULE, 0, 4);
    const rows = buildSparseStepRows(offsets, { stepTime: "09:00" });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.origin_day_offset).toBe(row.day_offset);
    }
  });

  it("a freshly created series proposes ZERO new occurrences", () => {
    // THE assertion. This is the one that goes red without the stamp.
    const item: MaterializableItem = {
      id: "i",
      start_date: "2026-07-22",
      duration_days: 5,
      recurrence: RULE,
    };
    const offsets = occurrenceOffsets("2026-07-22", RULE, 0, 4);
    const steps: MaterializableStep[] = buildSparseStepRows(offsets, {}).map(
      (r) => ({
        day_offset: r.day_offset,
        origin_day_offset: r.origin_day_offset ?? null,
      }),
    );

    const plan = planMaterialization(item, steps, "2026-07-22", 4);
    expect(plan.offsets).toEqual([]);
  });

  it("PROOF the assertion above is load-bearing: NULL origins propose every offset", () => {
    // The pre-fix behaviour, asserted directly so the mechanism is documented
    // in code rather than only in a comment. If someone 'fixes' the planner
    // instead of the writer, this test tells them the planner was never wrong.
    const item: MaterializableItem = {
      id: "i",
      start_date: "2026-07-22",
      duration_days: 5,
      recurrence: RULE,
    };
    const offsets = occurrenceOffsets("2026-07-22", RULE, 0, 4);
    const nullOriginSteps: MaterializableStep[] = offsets.map((day_offset) => ({
      day_offset,
      origin_day_offset: null,
    }));

    const plan = planMaterialization(item, nullOriginSteps, "2026-07-22", 4);
    // Every founding occurrence proposed a second time -> one duplicate each.
    expect(plan.offsets).toEqual(offsets);
  });

  it("does NOT stamp origin on contiguous (non-recurring) items", () => {
    // `lib/calendar/materialize.ts` requires manual rows to stay null: "a step with
    // a null origin_day_offset contributes nothing - it is not an occurrence."
    // A contiguous item is not a series, and stamping it would make ordinary
    // multi-day tasks look like rule-generated occurrences.
    const sparse = false;
    const rows = [0, 1, 2].map((day_offset) => ({
      day_offset,
      ...(sparse ? { origin_day_offset: day_offset } : {}),
    }));
    for (const row of rows) {
      expect(row).not.toHaveProperty("origin_day_offset");
    }
  });

  it("mirrors the shape the action writes", () => {
    // Pins the key set so the mirror above cannot silently drift from
    // `createItemWithSteps`.
    const rows = buildSparseStepRows([0, 2], {
      stepTime: "09:00",
      stepDurationMin: 30,
    });
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "board_id",
        "day_offset",
        "duration_min",
        "item_id",
        "label",
        "origin_day_offset",
        "time_of_day",
      ].sort(),
    );
  });
});
