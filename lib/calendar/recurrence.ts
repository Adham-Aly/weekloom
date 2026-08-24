// Recurring-series math. A series is an item whose `recurrence` rule
// generates its steps (one per occurrence) at sparse day offsets from the
// item's start_date. Materialization is a rolling window: we only ever
// store occurrences ~MATERIALIZE_AHEAD_DAYS out, and extend lazily on
// board load (see board.tsx) — "infinite" without infinite rows.

import type { Recurrence } from "@/lib/types/database";

/** Rolling materialization horizon, in days past today. */
export const MATERIALIZE_AHEAD_DAYS = 56;

function parseLocalDate(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

/** Whole-day difference b - a between two ISO dates (local, DST-safe). */
export function daysBetweenISO(a: string, b: string): number {
  const ms = parseLocalDate(b).getTime() - parseLocalDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Day offsets (relative to the series start date) where the rule fires,
 * within [fromOffset, toOffset] inclusive. Respects `rule.until` (series
 * end date, inclusive). Offsets below 0 are never returned.
 */
export function occurrenceOffsets(
  seriesStartISO: string,
  rule: Recurrence,
  fromOffset: number,
  toOffset: number,
): number[] {
  if (rule.days.length === 0) return [];
  const startDay = parseLocalDate(seriesStartISO).getDay();
  const wanted = new Set(rule.days);
  const lo = Math.max(0, fromOffset);
  const hi =
    rule.until != null
      ? Math.min(toOffset, daysBetweenISO(seriesStartISO, rule.until))
      : toOffset;
  const out: number[] = [];
  for (let o = lo; o <= hi; o++) {
    if (wanted.has((startDay + o) % 7)) out.push(o);
  }
  return out;
}
