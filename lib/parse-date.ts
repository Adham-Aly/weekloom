/**
 * Lightweight natural-language date parser tailored to the Gantt jump UI.
 * Returns ISO date string (YYYY-MM-DD) or null. Local time, not UTC.
 *
 * Recognized:
 *   today | tomorrow | yesterday
 *   <weekday>                       → next occurrence
 *   next <weekday> | last <weekday>
 *   <N> day(s)/week(s)/month(s) ago
 *   in <N> day(s)/week(s)/month(s)
 *   YYYY-MM-DD
 *   M/D, M/D/YYYY
 *   <month> <D>[, YYYY]             ("Jun 5", "June 5, 2025")
 */
import { addDays, addMonths, addWeeks, toISODate } from "@/lib/utils";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep", "sept"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
];

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthIndex(name: string): number | null {
  const n = name.toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].includes(n)) return i;
  }
  return null;
}

export function parseDateInput(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const t = today();

  if (s === "today" || s === "now") return toISODate(t);
  if (s === "tomorrow" || s === "tmrw" || s === "tmr")
    return toISODate(addDays(t, 1));
  if (s === "yesterday") return toISODate(addDays(t, -1));

  // Bare relative phrases: "next week" / "last month" / "this year" / "weekend"
  if (s === "next week") return toISODate(addDays(t, 7));
  if (s === "last week") return toISODate(addDays(t, -7));
  if (s === "this week") return toISODate(t);
  if (s === "next month") return toISODate(addMonths(t, 1));
  if (s === "last month") return toISODate(addMonths(t, -1));
  if (s === "this month") return toISODate(t);
  if (s === "next year") return toISODate(addMonths(t, 12));
  if (s === "last year") return toISODate(addMonths(t, -12));
  if (s === "weekend" || s === "this weekend") {
    const sat = (6 - t.getDay() + 7) % 7 || 7;
    return toISODate(addDays(t, sat));
  }
  // "in a week" / "in a month" / "in a year"
  const inA = /^in\s+a\s+(day|week|month|year)$/i.exec(s);
  if (inA) {
    const unit = inA[1].toLowerCase();
    if (unit === "year") return toISODate(addMonths(t, 12));
    return shiftBy(t, 1, unit);
  }
  // "a week ago" / "a month ago"
  const aAgo = /^a\s+(day|week|month|year)\s+ago$/i.exec(s);
  if (aAgo) {
    const unit = aAgo[1].toLowerCase();
    if (unit === "year") return toISODate(addMonths(t, -12));
    return shiftBy(t, -1, unit);
  }

  // "next monday" / "last friday" / bare weekday
  const wkMatch =
    /^(?:(next|last|this)\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:[a-z]*)$/i.exec(
      s,
    );
  if (wkMatch) {
    const dir = wkMatch[1]?.toLowerCase() ?? "next";
    const day = wkMatch[2].toLowerCase();
    const wkIdx = WEEKDAYS.findIndex((w) => w.startsWith(day));
    if (wkIdx >= 0) {
      const diff = (wkIdx - t.getDay() + 7) % 7 || 7;
      const base = dir === "last" ? -((t.getDay() - wkIdx + 7) % 7 || 7) : diff;
      return toISODate(addDays(t, dir === "this" ? diff % 7 : base));
    }
  }

  // "in 3 days" / "3 days ago" / "in 2 weeks" / "1 month ago"
  const relIn = /^in\s+(\d+)\s+(day|week|month)s?$/i.exec(s);
  if (relIn) return shiftBy(t, parseInt(relIn[1], 10), relIn[2]);
  const relAgo = /^(\d+)\s+(day|week|month)s?\s+ago$/i.exec(s);
  if (relAgo) return shiftBy(t, -parseInt(relAgo[1], 10), relAgo[2]);

  // ISO YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return iso[0];

  // M/D or M/D/YYYY
  const mdy = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (mdy) {
    const m = parseInt(mdy[1], 10);
    const d = parseInt(mdy[2], 10);
    let y = mdy[3] ? parseInt(mdy[3], 10) : t.getFullYear();
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return toISODate(new Date(y, m - 1, d));
    }
  }

  // "Jun 5", "June 5, 2025", "5 June"
  const mdName = /^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{2,4}))?$/i.exec(s);
  if (mdName) {
    const mi = monthIndex(mdName[1]);
    if (mi !== null) {
      const d = parseInt(mdName[2], 10);
      let y = mdName[3] ? parseInt(mdName[3], 10) : t.getFullYear();
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31) {
        // If no year given and the date is already past, roll forward to next year
        const candidate = new Date(y, mi, d);
        if (!mdName[3] && candidate < t) candidate.setFullYear(y + 1);
        return toISODate(candidate);
      }
    }
  }

  // "5 Jun"
  const dmName = /^(\d{1,2})\s+([a-z]+)(?:,?\s+(\d{2,4}))?$/i.exec(s);
  if (dmName) {
    const mi = monthIndex(dmName[2]);
    if (mi !== null) {
      const d = parseInt(dmName[1], 10);
      let y = dmName[3] ? parseInt(dmName[3], 10) : t.getFullYear();
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31) {
        const candidate = new Date(y, mi, d);
        if (!dmName[3] && candidate < t) candidate.setFullYear(y + 1);
        return toISODate(candidate);
      }
    }
  }

  return null;
}

function shiftBy(t: Date, n: number, unit: string): string {
  const u = unit.toLowerCase();
  if (u.startsWith("day")) return toISODate(addDays(t, n));
  if (u.startsWith("week")) return toISODate(addWeeks(t, n));
  if (u.startsWith("month")) return toISODate(addMonths(t, n));
  return toISODate(t);
}
