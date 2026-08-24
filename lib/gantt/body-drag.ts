import { effectiveDeadlineOffset } from "@/lib/utils";
import { isoAtOffset } from "@/lib/gantt/layout";
import type { Item, Step } from "@/lib/types/database";

/** Mirrors the `deadline_offset` / `day_offset` upper bound in lib/actions/schemas.ts. */
const MAX_OFFSET = 3650;

export type BodyDragResult = {
  /** Undone steps to re-offset — only those whose `day_offset` actually changes. */
  stepUpdates: { id: string; day_offset: number }[];
  /** New `items.start_date`, or undefined if unchanged. */
  newStartDate: string | undefined;
  /** New `items.deadline_offset`, or undefined if unchanged. */
  newDeadlineOffset: number | undefined;
  /** A body drag never changes duration_days. Kept for `applyItemMove` parity. */
  newDuration: undefined;
  /**
   * True when a forward drag has pushed the start onto/past the deadline — the
   * whole task is already stacked on the deadline column and there's nothing
   * left to compress. The caller should confirm "this will move the deadline"
   * and fall back to a legacy start-only move.
   */
  exhausted: boolean;
  /** True when nothing changes (dStart === 0). */
  noop: boolean;
};

/**
 * Pure computation for "drag a task bar's body by `dStart` days while keeping
 * the deadline's absolute date fixed (sticky)".
 *
 * The deadline is stored as `item.deadline_offset`, a column offset relative to
 * `start_date`; the rendered deadline floors to the last undone step
 * (`effectiveDeadlineOffset`). Let `E` be that effective offset, so the fixed
 * absolute deadline column is `start_date + E`. Dragging the bar **forward**
 * sweeps the start later, and any cell the start passes PILES UP AT THE NEW
 * START — i.e. the skipped days stack at the front. Cells the start hasn't
 * reached yet keep their absolute day; the deadline never moves:
 *
 *   - Relative to the moved start, each cell lands at
 *     `max(0, day_offset - dStart)` and the deadline at `E - dStart`. A cell
 *     with `day_offset >= dStart` keeps its absolute position; one the start
 *     has overtaken (`day_offset < dStart`) collapses onto the start column.
 *   - Example (3 cells at 0,1,2; deadline at 3): +1 → cells `[0,0,1]` (the first
 *     two stack), +2 → `[0,0,0]` (all stacked on the day before the deadline).
 *   - At `dStart = E` the whole stack sits on the deadline column; at
 *     `dStart > E` the start has reached the deadline → `exhausted`, and the
 *     caller warns + does a legacy "deadline rides with the bar" move.
 *
 * Backward drags slide the task earlier rigidly (offsets unchanged) while the
 * deadline stays put — more room opens up, nothing stacks. Timed cells stack
 * like any other (their time-of-day is preserved; only the day moves).
 * `undoneSteps` must already be filtered to `status !== "done"`.
 *
 * `dStart > 0` moves the task later (forward); `dStart < 0` moves it earlier.
 */
export function computeBodyDrag(
  item: Item,
  undoneSteps: Step[],
  dStart: number,
): BodyDragResult {
  const base: BodyDragResult = {
    stepUpdates: [],
    newStartDate: undefined,
    newDeadlineOffset: undefined,
    newDuration: undefined,
    exhausted: false,
    noop: true,
  };
  if (dStart === 0) return base;

  const offsets = undoneSteps.map((s) => s.day_offset);
  const e = effectiveDeadlineOffset(item.deadline_offset, offsets);

  // Forward drag that sweeps the start onto/past the deadline → nothing left to
  // compress; caller warns + legacy move (the deadline finally shifts).
  if (dStart > e) {
    return { ...base, exhausted: true, noop: false };
  }

  const stepUpdates: { id: string; day_offset: number }[] = [];
  for (const s of undoneSteps) {
    // Forward: the start sweeps over earlier cells, piling them at the new
    // start (offset 0); cells ahead keep their day. Backward: the task slides
    // back rigidly, so offsets are unchanged.
    const next = dStart > 0 ? Math.max(0, s.day_offset - dStart) : s.day_offset;
    if (next !== s.day_offset) stepUpdates.push({ id: s.id, day_offset: next });
  }

  const newDeadline = Math.max(0, Math.min(MAX_OFFSET, e - dStart));
  const newDeadlineOffset =
    newDeadline !== item.deadline_offset ? newDeadline : undefined;

  return {
    stepUpdates,
    newStartDate: isoAtOffset(item.start_date, dStart),
    newDeadlineOffset,
    newDuration: undefined,
    exhausted: false,
    noop: false,
  };
}

export type LeftPullResult = {
  /** Existing undone steps to re-offset (spread into the staircase). */
  stepUpdates: { id: string; day_offset: number }[];
  /** Offsets at which to create new TBD steps (empty until the staircase fills). */
  addOffsets: number[];
  /** New `items.start_date`. */
  newStartDate: string | undefined;
  /** New `items.deadline_offset`, or undefined if unchanged. */
  newDeadlineOffset: number | undefined;
  /** New `items.duration_days`, or undefined if unchanged. */
  newDuration: number | undefined;
  /** True when nothing changes. */
  noop: boolean;
};

/**
 * Pure computation for "pull the task bar's LEFT EDGE back (earlier) while the
 * deadline stays fixed" — the inverse of the forward-drag stacking. Extending
 * the start earlier re-spreads the cells that the forward drag had piled up,
 * undoing the stacking before any new days are added.
 *
 * Let `E` be the effective deadline offset (so the fixed absolute deadline is
 * `start + E`) and `N` the undone-cell count. Pulling back by `P = -dStart`
 * days grows the deadline offset to `E_new = E + P`. The existing cells
 * right-align against the day before the deadline (offset `E_new - 1`) as a
 * one-per-day staircase, with any excess still stacked at the new start:
 *   cell ranked j (0 = leftmost) → offset max(0, j + E_new - N).
 * Cells are ranked by current column, then untimed-before-timed, so a scheduled
 * cell lands at the rightmost (latest) staircase step. Once the existing cells
 * form a full staircase (`E_new > N`), the extra left columns are filled with
 * `E_new - N` brand-new TBD cells at offsets `0 .. E_new-N-1`.
 *
 * Only handles pulling back (`dStart < 0`); a shrink-from-left (`dStart >= 0`)
 * stays on the legacy resize path. `undoneSteps` must already be filtered to
 * `status !== "done"`.
 */
export function computeLeftPull(
  item: Item,
  undoneSteps: Step[],
  dStart: number,
): LeftPullResult {
  const empty: LeftPullResult = {
    stepUpdates: [],
    addOffsets: [],
    newStartDate: undefined,
    newDeadlineOffset: undefined,
    newDuration: undefined,
    noop: true,
  };
  if (dStart >= 0) return empty;

  const offsets = undoneSteps.map((s) => s.day_offset);
  const n = undoneSteps.length;
  const e = effectiveDeadlineOffset(item.deadline_offset, offsets);
  const eNew = Math.min(MAX_OFFSET, e - dStart); // dStart < 0 → eNew = e + |dStart|

  // Spread the existing cells into a staircase right-aligned at offset eNew-1.
  // Rank by current column, then untimed-before-timed so a scheduled (timed)
  // cell ends up at the rightmost step — restoring the pre-stack shape.
  const ranked = [...undoneSteps].sort((a, b) => {
    if (a.day_offset !== b.day_offset) return a.day_offset - b.day_offset;
    const at = a.time_of_day;
    const bt = b.time_of_day;
    if (!at && bt) return -1;
    if (at && !bt) return 1;
    if (at && bt) return at < bt ? -1 : at > bt ? 1 : 0;
    return 0;
  });
  const stepUpdates: { id: string; day_offset: number }[] = [];
  ranked.forEach((s, j) => {
    const next = Math.max(0, j + eNew - n);
    if (next !== s.day_offset) stepUpdates.push({ id: s.id, day_offset: next });
  });

  // New TBD cells fill the leftmost columns only once the existing cells are a
  // full one-per-day staircase (eNew > n).
  const addCount = Math.max(0, eNew - n);
  const addOffsets = Array.from({ length: addCount }, (_, i) => i);

  const newDeadlineOffset =
    eNew !== item.deadline_offset ? eNew : undefined;
  const grown = Math.max(item.duration_days, eNew);
  const newDuration = grown !== item.duration_days ? grown : undefined;

  return {
    stepUpdates,
    addOffsets,
    newStartDate: isoAtOffset(item.start_date, dStart),
    newDeadlineOffset,
    newDuration,
    noop: stepUpdates.length === 0 && addOffsets.length === 0,
  };
}
