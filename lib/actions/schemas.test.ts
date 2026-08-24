import { describe, expect, it } from "vitest";
import {
  applyItemMoveSchema,
  stepUpdateSchema,
  type ApplyItemMoveInput,
} from "./schemas";

// Real v4 UUIDs: zod validates the version nibble, so the nil UUID is rejected.
const ITEM_ID = "3f1a7c4e-9b2d-4e8a-8c6f-1d5b9e2a7c30";
const STEP_ID = "7a2e5d18-4c93-4b6f-9e1a-2f8c6d0b3a51";

/**
 * These tests exist to protect a MECHANISM, not a behaviour.
 *
 * `applyItemMove`'s call sites are checked at compile time only because
 * `ApplyItemMoveInput = z.input<typeof applyItemMoveSchema>` and `ruleDelta`
 * has no `.default()`. Add one — the single most natural "tidy-up" anyone could
 * make to that line — and `z.input` silently marks the field optional, every
 * call-site check stops firing, zod supplies 0, and a rule rotation freezes
 * every origin while positions move. The materializer then mints on top of the
 * steps that already moved: ~9 duplicates from one drag, one per live series.
 *
 * That failure has already happened once. It was invisible: no error, no failing
 * test, and a comment above the field saying not to do it.
 */
describe("applyItemMoveSchema — ruleDelta must stay REQUIRED", () => {
  it("fails the build if someone adds .default() to ruleDelta", () => {
    // @ts-expect-error — ruleDelta is REQUIRED and must stay required. If this
    // line STOPS erroring, someone gave it a `.default()`: `z.input` then makes
    // it optional, every `applyItemMove` call site silently stops being checked,
    // and a rotation freezes origins. The unused-directive error IS the alarm.
    const missingRuleDelta: ApplyItemMoveInput = {
      itemId: ITEM_ID,
      stepUpdates: [],
    };
    expect(missingRuleDelta).toBeDefined();
  });

  it("rejects a payload with no ruleDelta at runtime too", () => {
    // The type is the mechanism for honest callers; zod is the one for the wire.
    const parsed = applyItemMoveSchema.safeParse({
      itemId: ITEM_ID,
      stepUpdates: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts 0 — the true value for every caller that is not a rotation", () => {
    const parsed = applyItemMoveSchema.safeParse({
      itemId: ITEM_ID,
      stepUpdates: [],
      ruleDelta: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it("carries a rotation's delta through unchanged", () => {
    const parsed = applyItemMoveSchema.parse({
      itemId: ITEM_ID,
      stepUpdates: [{ id: STEP_ID, day_offset: 14 }],
      ruleDelta: 7,
    });
    expect(parsed.ruleDelta).toBe(7);
  });
});

/**
 * The other half of the same mechanism, and it is a COMPILE-time assertion
 * rather than a test — which is why it sits at module scope with no `it`
 * around it.
 *
 * `stepUpdates` carries no version / expectation field, and must not gain one.
 * A stale-write precondition answers a question that cannot arise: one process
 * owns the database file, so a row can only have moved because of a write this
 * same session already made, and every rejection would be false. The caller
 * that suffers most is undo, which restores a snapshot OVER current state by
 * definition.
 *
 * ⚠️ **The unused-directive error IS the alarm.** If someone adds
 * `expected_updated_at` back to the schema, this excess-property error stops
 * firing, `@ts-expect-error` becomes an unused directive, and `tsc` fails the
 * build. A runtime `expect(...).toBeUndefined()` could not do that: zod strips
 * unknown keys, so it reads `undefined` whether the field was removed or never
 * sent.
 */
const noVersionField: ApplyItemMoveInput = {
  itemId: ITEM_ID,
  stepUpdates: [
    {
      id: STEP_ID,
      day_offset: 3,
      // @ts-expect-error — see above. This key must not be assignable.
      expected_updated_at: "2026-07-16T10:00:00.123456+00:00",
    },
  ],
  ruleDelta: 0,
};
// Referenced so the declaration is not dead code. The assertion is the type
// annotation above, not anything this line does at runtime.
void noVersionField;

describe("stepUpdateSchema.time_of_day — only real wall-clock times", () => {
  // The old `\d{2}:\d{2}` shape admitted "24:15", which is not a wall-clock
  // time. (A drag below the calendar grid's midnight bottom edge produced
  // exactly that value.) Letting it through means the row carries a time no
  // reader can format, and the client never learns: `persist()` logs a failed
  // write and drops it, with no rollback and no retry anywhere. So the schema
  // must reject it as a clean validation error at the boundary instead.
  it.each(["24:15", "25:30", "99:99", "12:60", "7:30"])("rejects %s", (bad) => {
    expect(stepUpdateSchema.safeParse({ time_of_day: bad }).success).toBe(
      false,
    );
  });

  it.each(["00:00", "23:45", "09:05", "17:00:00"])("accepts %s", (good) => {
    expect(stepUpdateSchema.safeParse({ time_of_day: good }).success).toBe(
      true,
    );
  });

  it("still accepts null (unschedule → TBD)", () => {
    expect(stepUpdateSchema.safeParse({ time_of_day: null }).success).toBe(
      true,
    );
  });
});
