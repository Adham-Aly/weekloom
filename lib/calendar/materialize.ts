/**
 * Planning the occurrences a recurring series is missing.
 *
 * Pure: this module decides *what* should exist and never writes anything.
 * `lib/db/rpc/materialize-series.ts` does the writing and
 * `lib/db/materialize.ts` drives the loop.
 *
 * ## The watermark is the whole design
 *
 * Materializing is "extend this series to the horizon", and the only question
 * that matters is **how far has it already been extended?**
 *
 * The obvious answer — `Math.max(...steps.map(s => s.day_offset))` — is wrong,
 * because `day_offset` is *mutable*. Drag the furthest occurrence backwards and
 * that watermark drops, so the next materialization refills the slot the user
 * just deliberately vacated. That is not hypothetical; it is the bug this module
 * was written to end.
 *
 * The fix is to measure the watermark in a coordinate the user cannot move:
 *
 * > **`origin_day_offset` is where the *rule* put an occurrence.
 * > `day_offset` is where the *user* put it.**
 *
 * The watermark reads **origin, always** — never `day_offset`, and never a fork
 * on `detached`. Both were tried and both were wrong; see `originOffsetOf`.
 *
 * That works because origin is maintained in exactly one place. Every gesture
 * that moves a series goes through `applyItemMove`, which shifts origin by the
 * item's `start_date` delta plus whatever the caller states in `ruleDelta`:
 *
 * | gesture | `ruleDelta` | origin |
 * |---|---|---|
 * | scope-"all" rotation (`board.tsx`) | `dayDelta` | shifts with the rule |
 * | arrow-shift / body-drag (`shift.ts`) | `0` | **frozen** — the user moved one occurrence |
 * | item rebase (`newStartDate`) | `0` | rebases with the item |
 *
 * A rotation and an arrow-shift reach that function in the *identical* shape (N
 * `stepUpdates`, no `newStartDate`) and need *opposite* behaviour. No formula
 * can tell them apart, so the caller states it — and `ruleDelta` is required in
 * the type, so it cannot be forgotten rather than merely remembered.
 *
 * ## Why there is no deterministic occurrence id here
 *
 * A deterministic id such as `uuidv5(item_id + ":" + day_offset)` looks like it
 * would make two materializations idempotent, and the key is unsafe either way:
 * `upsert` clobbers a moved occurrence (dragging it back and clearing
 * `detached`), while `ON CONFLICT DO NOTHING` silently skips a genuinely new
 * one. Both failures exist only when there is no transaction to decide inside,
 * so collision-on-a-key is the only dedup available.
 *
 * The writer has a real transaction. It inserts
 * `where not exists (item_id, origin_day_offset)` under the write lock — dedup
 * by **predicate**, not by **key collision**. Nothing can clobber (there is no
 * upsert) and nothing can silently skip (there is no key to alias).
 */

import { daysBetweenISO, occurrenceOffsets } from "@/lib/calendar/recurrence";
import type { Recurrence } from "@/lib/types/database";

export type MaterializableItem = {
  id: string;
  start_date: string;
  duration_days: number;
  recurrence: Recurrence | null;
};

/** The two columns materialization reads. `origin_day_offset` is null for rows
 *  that predate the column and for manually-added steps (`addStepAt`), which
 *  are not rule-generated occurrences and must not be treated as one. */
export type MaterializableStep = {
  day_offset: number;
  /**
   * Where the RULE put this occurrence. Null for rows that are not
   * rule-generated (`addStepAt`, `resizeItem`) — they are real steps but they
   * answer no question the watermark is asking.
   *
   * Note `detached` is deliberately absent: materialization does not care
   * whether the user moved an occurrence, only where the rule placed it, and
   * this column answers that directly. Reintroducing `detached` here is how the
   * arrow-shift bug got in.
   */
  origin_day_offset: number | null;
};

/** What `materializeSeries` needs to mint an occurrence's time fields. */
export type SeriesRule = { time: string; durationMin: number | null };

export type MaterializationPlan = {
  /** Offsets to create. Each becomes a step at `day_offset = origin_day_offset = o`. */
  offsets: number[];
  /** The item's new `duration_days`, or null when it needn't grow. */
  newDuration: number | null;
};

/**
 * The watermark: how far the **rule** has already been extended.
 *
 * Only rule-generated occurrences answer that question, so a step with a null
 * `origin_day_offset` contributes **nothing** — it is not an occurrence. That
 * covers `addStepAt` (arbitrary user-chosen offsets) and `resizeItem`'s grow
 * path, neither of which names the column.
 *
 * ⚠️ **There is deliberately no `?? day_offset` fallback**, and the naive
 * version of this function is a trap I fell into:
 *
 * - Feeding a manual step's `day_offset` into the watermark **silently skips
 *   real occurrences**. One `addStepAt` six months out (`day_offset` is capped
 *   at 3650, so that is nothing) pushes the watermark past the horizon and the
 *   series **never materializes again** — reproducing, for an active user, the
 *   exact silent failure this module exists to eliminate.
 * - "Walking over" a manual step is not a real cost: a rule step and a manual
 *   step on the same day is two steps on one day, which the product explicitly
 *   supports — it is why `unique(item_id, day_offset)` is illegal. That is a
 *   supported, *visible* double-up. The fallback trades it for a *silent* skip,
 *   which is the worse failure by this design's own rule.
 *
 * The fallback's only honest use would be reading rows written before the
 * column existed, and there are none: the column is in version 1 of the schema,
 * so every row that has ever existed here has it. Null means *only* "not an
 * occurrence", and the fallback would be unconditionally wrong.
 */
export function originOffsetOf(step: MaterializableStep): number | null {
  // Pure origin. **Never `detached ? origin : day_offset`** — that fork was
  // here and it was wrong; this comment exists so it doesn't come back.
  //
  // The fork's premise was: "a non-detached step is still exactly where the
  // rule put it, so day_offset IS its origin — and reading day_offset is what
  // makes the watermark survive a scope-'all' rotation, since the rotation
  // shifts positions while origin stays put."
  //
  // **That premise died when `p_rule_delta` landed.** The rotation now routes
  // through `applyItemMove({ ruleDelta: dayDelta })` and the RPC shifts
  // `origin_day_offset` by exactly that, so origin is no longer left behind in
  // the old coordinate system. The compensation the fork provided is now done
  // properly, one layer down.
  //
  // And the fork actively broke the case this column exists for. `shift.ts`
  // (the arrow-shift) sends `ruleDelta: 0`, so the RPC correctly **freezes**
  // origin — but `shift.ts` never touches `detached`, so the step stays
  // `detached: false`, and the fork then read the *moved* `day_offset` and
  // **threw away the freeze the RPC had just performed**. Arrow-shift the
  // furthest occurrence backwards (21 → 15) and the watermark dropped to 15, so
  // the next materialization refilled offset 21 — the slot the user had just
  // vacated. Verbatim the bug in this file's own header, reached by a keyboard
  // gesture rather than a rare drag.
  //
  // `detached` was never the right discriminator: it asks "did the user move
  // this?", and the question the watermark needs is "where did the rule put
  // it?" — which is what this column answers directly. Any path that freezes
  // origin without setting `detached` (`shift.ts` today; `swapSteps` before it
  // was fixed to set the flag) reopened the hole. Reading origin is immune to
  // all of them.
  return step.origin_day_offset;
}

/**
 * ⚠️ Fails loudly when the `origin_day_offset` column is absent.
 *
 * A caller that hands over rows it assembled itself, rather than rows from
 * `toStep`, can omit the key entirely — and an absent key reads as `undefined`,
 * not `null`. Silently treating that as "no occurrences" would make every series
 * look unmaterialized; silently falling back to `day_offset` would restore the
 * mutable-watermark bug this module exists to fix. Neither is acceptable for the
 * column this module's correctness rests on, so an absent one is an error, not a
 * default.
 */
function assertOriginColumn(steps: MaterializableStep[]): void {
  for (const s of steps) {
    if (!("origin_day_offset" in s)) {
      throw new Error(
        "steps.origin_day_offset is missing — refusing to materialize against a mutable watermark",
      );
    }
  }
}

/**
 * Plan the occurrences a series is missing. Pure — the caller does the I/O.
 *
 * Returns only offsets strictly beyond the series' watermark, so this never
 * proposes to fill a gap: a gap in the middle of a series is either a deleted
 * occurrence or a moved one, and both are user intent. Inferring intent from
 * absence is exactly what the rest of this design refuses to do.
 */
export function planMaterialization(
  item: MaterializableItem,
  steps: MaterializableStep[],
  todayISO: string,
  aheadDays: number,
): MaterializationPlan {
  const rule = item.recurrence;
  if (!rule) return { offsets: [], newDuration: null };
  assertOriginColumn(steps);

  const targetOffset = daysBetweenISO(item.start_date, todayISO) + aheadDays;
  // Only rule-generated occurrences move the watermark. A manual step is a real
  // row, but it is not evidence that the rule has been extended to its offset.
  const origins = steps
    .map(originOffsetOf)
    .filter((o): o is number => o != null);
  const watermark = origins.length ? Math.max(...origins) : -1;

  const offsets = occurrenceOffsets(
    item.start_date,
    rule,
    watermark + 1,
    targetOffset,
  );
  if (offsets.length === 0) return { offsets: [], newDuration: null };

  // Duration only ever grows. Shrinking it here would orphan steps that sit
  // past the new end — `duration_days` is the item's rendered span, not a
  // count, and `resizeItem`'s own comment concedes that gaps make "count and
  // max+1 diverge".
  const span = offsets[offsets.length - 1] + 1;
  return {
    offsets,
    newDuration: span > item.duration_days ? span : null,
  };
}
