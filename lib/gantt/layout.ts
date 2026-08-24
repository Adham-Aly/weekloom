import { addDays } from "date-fns";
import { daysBetween, toISODate } from "@/lib/utils";
import type { Item, Step } from "@/lib/types/database";

/**
 * Parse an ISO date string (YYYY-MM-DD) into a local-midnight Date. Equivalent
 * to `new Date(iso + "T00:00:00")` but extracted so we don't repeat the trick
 * a dozen times.
 */
export function parseISODate(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

/**
 * One-dimensional greedy packing for non-overlapping horizontal bars/pills.
 * Returns a Map from item key to the row index it should render on. Items are
 * placed in ascending `left` order; each item lands in the lowest-indexed row
 * whose right edge plus `gap` is ≤ the item's left edge.
 */
export type PackItem = { key: string; left: number; width: number };
export type PackResult = {
  rowByKey: Map<string, number>;
  rowEnds: number[];
};
export function greedyPack(items: PackItem[], gap: number = 0): PackResult {
  const rowByKey = new Map<string, number>();
  const rowEnds: number[] = [];
  const sorted = [...items].sort((a, b) => a.left - b.left);
  for (const it of sorted) {
    let placed = false;
    for (let r = 0; r < rowEnds.length; r++) {
      if (rowEnds[r] + gap <= it.left) {
        rowByKey.set(it.key, r);
        rowEnds[r] = it.left + it.width;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rowByKey.set(it.key, rowEnds.length);
      rowEnds.push(it.left + it.width);
    }
  }
  return { rowByKey, rowEnds };
}

/**
 * Estimated pill width from label length, used for greedy-pack collision
 * detection in the deadline strip. Approximates 6.2px per character plus 70px
 * of fixed padding (icon + chip + spacing).
 */
export function estimatePillWidth(label: string): number {
  return Math.max(80, label.length * 6.2 + 70);
}

export type ItemBarRange = {
  /** Column index where the bar starts within the visible range. */
  visibleStartIdx: number;
  /** Column index where the bar ends within the visible range. */
  visibleEndIdx: number;
  /** False if the item lies entirely outside the visible window. */
  inRange: boolean;
};

/**
 * Compute the column-index range an item's bar occupies within a visible Gantt
 * window. The bar spans from the first undone step to the last; falls back to
 * the full duration if every step is already done.
 */
export function computeItemBarRange(
  item: Item,
  itemSteps: readonly Step[],
  rangeStartISO: string,
  visibleDays: number,
): ItemBarRange {
  const undone = itemSteps.filter((s) => s.status !== "done");
  const startOffset = undone.length
    ? Math.min(...undone.map((s) => s.day_offset))
    : 0;
  const endOffset = undone.length
    ? Math.max(...undone.map((s) => s.day_offset))
    : item.duration_days - 1;
  const itemStartIdx = daysBetween(rangeStartISO, item.start_date);
  const startIdx = itemStartIdx + startOffset;
  const endIdx = itemStartIdx + endOffset;
  const visibleStartIdx = Math.max(0, startIdx);
  const visibleEndIdx = Math.min(visibleDays - 1, endIdx);
  return {
    visibleStartIdx,
    visibleEndIdx,
    inRange: visibleEndIdx >= 0 && visibleStartIdx <= visibleDays - 1,
  };
}

/**
 * Convenience: ISO date for `item.start_date + offset` days. Avoids the
 * repeated `toISODate(addDays(new Date(iso + "T00:00:00"), n))` chant.
 */
export function isoAtOffset(itemStartISO: string, offsetDays: number): string {
  return toISODate(addDays(parseISODate(itemStartISO), offsetDays));
}
