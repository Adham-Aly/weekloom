import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  parseISO,
  startOfDay,
} from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toISODate(d: Date): string {
  // YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISODate(s: string): Date {
  // Parse YYYY-MM-DD as local midnight
  return startOfDay(parseISO(s));
}

export function daysBetween(startISO: string, endISO: string): number {
  return differenceInCalendarDays(fromISODate(endISO), fromISODate(startISO));
}

/**
 * The deadline column for an item. The stored `deadline_offset` is a user-set
 * floor (only the user moves it). The displayed column is always at least one
 * past the rightmost step, so growing steps push it forward but it never
 * drifts backward on its own.
 */
export function effectiveDeadlineOffset(
  itemDeadlineOffset: number,
  stepOffsets: readonly number[],
): number {
  if (stepOffsets.length === 0) return itemDeadlineOffset;
  const stepFloor = Math.max(...stepOffsets);
  return Math.max(itemDeadlineOffset, stepFloor);
}

export function buildDateRange(start: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < count; i++) out.push(addDays(start, i));
  return out;
}

/** Sunday (local midnight) of the week containing `d`. */
export function startOfWeekSun(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return addDays(x, -x.getDay()); // getDay(): 0 = Sunday
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

export function fmtDay(d: Date) {
  return format(d, "EEE");
}
export function fmtDate(d: Date) {
  return format(d, "MMM d");
}
export function fmtFull(d: Date) {
  return format(d, "MMM d, yyyy");
}
export function fmtMonthYear(d: Date) {
  return format(d, "MMMM yyyy");
}

/** Format a "HH:MM" or "HH:MM:SS" string as "9:30 AM". */
export function fmtTime12(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h24 = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${min} ${ampm}`;
}

/**
 * Format a time range like Google Calendar: "7-7:30PM", "9:15-10:30AM",
 * "11AM-1PM", "9AM" (when start === end). Inputs are "HH:MM" 24h.
 */
export function fmtTimeRange12(
  startT: string | null | undefined,
  endT: string | null | undefined,
): string | null {
  if (!startT) return null;
  const s = parseHM(startT);
  if (!s) return null;
  const e = endT ? parseHM(endT) : null;

  function partAndPeriod(
    h: number,
    m: number,
  ): { h12: number; m: number; pm: boolean } {
    const pm = h >= 12;
    const h12 = h % 12 || 12;
    return { h12, m, pm };
  }
  function fmt(part: { h12: number; m: number }, withMin: boolean) {
    return withMin || part.m !== 0
      ? `${part.h12}:${String(part.m).padStart(2, "0")}`
      : `${part.h12}`;
  }

  const sp = partAndPeriod(s.h, s.m);
  if (!e || (e.h === s.h && e.m === s.m)) {
    return `${fmt(sp, false)}${sp.pm ? "PM" : "AM"}`;
  }
  const ep = partAndPeriod(e.h, e.m);
  const sameMeridiem = sp.pm === ep.pm;
  if (sameMeridiem) {
    return `${fmt(sp, false)}-${fmt(ep, false)}${ep.pm ? "PM" : "AM"}`;
  }
  return `${fmt(sp, false)}${sp.pm ? "PM" : "AM"}-${fmt(ep, false)}${ep.pm ? "PM" : "AM"}`;
}

function parseHM(t: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(min)) return null;
  return { h, m: min };
}

/**
 * Parse a flexible 12/24-hour time string into a canonical "HH:MM" 24h string.
 * Accepts: "9", "9:30", "9 AM", "9:30 AM", "21:00". Returns null on bad input.
 */
export function parseFlexTime(input: string): string | null {
  const t = input.trim();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (isNaN(h) || isNaN(min) || min > 59) return null;
  const ampm = m[3]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === "pm" && h !== 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function addWeeks(d: Date, n: number): Date {
  return addDays(d, n * 7);
}
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

export { addDays, format, isSameDay, parseISO, startOfDay };
