import { effectiveDeadlineOffset } from "@/lib/utils";
import { isoAtOffset } from "@/lib/gantt/layout";
import type { Item, Step } from "@/lib/types/database";

export type ShiftInput = {
  item: Item;
  itemSteps: Step[];
  movingStepIds: Set<string>;
  movingDeadline: boolean;
  /** Day delta to shift by — ±1 for arrow keys, any integer for drag. */
  delta: number;
};

export type ShiftResult = {
  stepUpdates: { id: string; day_offset: number }[];
  /** New `items.duration_days`, or undefined if unchanged. */
  newDuration: number | undefined;
  /** New `items.start_date`, or undefined if unchanged. */
  newStartDate: string | undefined;
  /** New `items.deadline_offset`, or undefined if unchanged. */
  newDeadlineOffset: number | undefined;
  /** True when the shift is a no-op — caller can early-return. */
  noop: boolean;
};

/**
 * Pure computation for "arrow-shift the current cell-selection by ±1 day".
 *
 * Behaviour the UI relies on:
 *   - Selected steps shift by `delta`, others stay put.
 *   - If the deadline is in the selection, it shifts too (using the *effective*
 *     deadline = max(stored, last step + 1) so a forward shift always
 *     visibly advances it).
 *   - If anything would land before column 0, the whole item slides right
 *     (start_date moves earlier) so nothing drops off the left edge.
 *   - duration_days grows to fit the new rightmost offset, but never shrinks.
 *   - deadline_offset only changes when the deadline was in the selection.
 *
 * Result fields are undefined when they didn't change; that matches the way
 * the action and the optimistic patch consume them.
 */
export function computeShift(input: ShiftInput): ShiftResult {
  const { item, itemSteps, movingStepIds, movingDeadline, delta } = input;
  const empty: ShiftResult = {
    stepUpdates: [],
    newDuration: undefined,
    newStartDate: undefined,
    newDeadlineOffset: undefined,
    noop: true,
  };
  if (!itemSteps.length && !movingDeadline) return empty;

  // Proposed per-step offsets (selected = shifted, others unchanged).
  const proposed = new Map<string, number>();
  for (const s of itemSteps) {
    proposed.set(
      s.id,
      movingStepIds.has(s.id) ? s.day_offset + delta : s.day_offset,
    );
  }

  const currentEffectiveDeadline = effectiveDeadlineOffset(
    item.deadline_offset,
    itemSteps.map((s) => s.day_offset),
  );
  // For a left shift (←): propose from the stored value so that when stored
  // is already below the effective floor, we still produce a new stored value
  // instead of a noop (effective-1 = stored → deadlineChanged = false).
  // For a right shift (→): propose from the effective value so the deadline
  // visually advances from where it currently appears, not from stored.
  const proposedDeadline = movingDeadline
    ? delta < 0
      ? item.deadline_offset + delta
      : currentEffectiveDeadline + delta
    : currentEffectiveDeadline;

  // Lowest offset across everything that will exist after the shift.
  const valuesForMin = [...proposed.values()];
  if (movingDeadline) valuesForMin.push(proposedDeadline);
  const minOff = valuesForMin.length ? Math.min(...valuesForMin) : 0;
  const normalizeBy = minOff < 0 ? -minOff : 0;
  const startDateDelta = -normalizeBy;

  const stepUpdates: { id: string; day_offset: number }[] = [];
  let maxStepFinal = -1;
  for (const [id, off] of proposed.entries()) {
    const final = off + normalizeBy;
    if (final > maxStepFinal) maxStepFinal = final;
    const original = itemSteps.find((s) => s.id === id)!.day_offset;
    if (final !== original) stepUpdates.push({ id, day_offset: final });
  }
  const finalDeadline = proposedDeadline + normalizeBy;

  // Don't let the deadline land before the last step.
  if (movingDeadline && maxStepFinal >= 0 && finalDeadline < maxStepFinal) {
    return empty;
  }

  const deadlineChanged = finalDeadline !== item.deadline_offset;
  const newDeadlineOffset = deadlineChanged ? finalDeadline : undefined;

  // duration_days = number of step rows. The deadline is a column marker
  // that can render past the last step (its own auto-push floor handles
  // that); it must NOT grow duration_days, or every arrow-shift on a fresh
  // item would phantom-add a step row.
  const desiredDuration = Math.max(item.duration_days, maxStepFinal + 1);
  const newDuration =
    desiredDuration !== item.duration_days ? desiredDuration : undefined;
  const newStartDate =
    startDateDelta !== 0
      ? isoAtOffset(item.start_date, startDateDelta)
      : undefined;

  const noop =
    stepUpdates.length === 0 &&
    newStartDate === undefined &&
    newDuration === undefined &&
    newDeadlineOffset === undefined;

  return {
    stepUpdates,
    newDuration,
    newStartDate,
    newDeadlineOffset,
    noop,
  };
}
