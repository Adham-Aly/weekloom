"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronUp, ChevronDown } from "@/components/icons";
import { addDays, cn, isToday, startOfWeekSun, toISODate } from "@/lib/utils";
import { parseISODate } from "@/lib/gantt/layout";

/**
 * MiniMonth + live pan tracking, isolated. The calendar reports whole-day
 * viewport offsets THROUGH A REF while the strip is mid-pan; holding that as
 * state anywhere higher (the board) re-renders the whole tree on every
 * day-crossing — mid-gesture re-renders are exactly the jitter the imperative
 * pan exists to avoid. This wrapper is the only thing that re-renders.
 */
export function MiniMonthLive({
  focusedISO,
  bandDays,
  onPickDate,
  register,
}: {
  focusedISO: string;
  bandDays?: number;
  onPickDate: (iso: string) => void;
  /** Handed a setter for the live day-offset; called with null on unmount. */
  register: (cb: ((days: number) => void) | null) => void;
}) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    register(setOffset);
    return () => register(null);
  }, [register]);
  // A committed shift bakes the offset into focusedISO itself — the preview
  // resets. Done DURING render (the derived-state pattern), not in an effect:
  // an effect resets one frame late, so the commit frame rendered
  // focusedISO(+N) + stale offset(N) = a band 2N ahead that then snapped back —
  // a visible flash on every settle.
  const [prevFocused, setPrevFocused] = useState(focusedISO);
  let shownOffset = offset;
  if (prevFocused !== focusedISO) {
    setPrevFocused(focusedISO);
    setOffset(0);
    shownOffset = 0;
  }
  const band =
    shownOffset === 0
      ? focusedISO
      : toISODate(addDays(parseISODate(focusedISO), shownOffset));
  return (
    <MiniMonth focusedISO={band} bandDays={bandDays} onPickDate={onPickDate} />
  );
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * A compact month grid for the calendar sidebar. Highlights the week the main
 * calendar is showing, marks today in the accent colour, dims out-of-month days,
 * and jumps the main calendar when a day is picked. Browsing months (the up/down
 * chevrons) is local; it re-centres on the focused week whenever that changes.
 */
export function MiniMonth({
  focusedISO,
  bandDays,
  onPickDate,
}: {
  /** The date the main calendar is centred on (week start, or the day in day view). */
  focusedISO: string;
  /**
   * Width of the highlight band in days, anchored at `focusedISO` — the main
   * calendar's actual viewport (which, since weeks are freely pannable, can
   * straddle two rows à la Notion). Absent → the Sunday-anchored week
   * containing `focusedISO` (the date-picker popover's behaviour).
   */
  bandDays?: number;
  onPickDate: (iso: string) => void;
}) {
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = parseISODate(focusedISO);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Follow the main calendar: when it moves to another month, re-centre here.
  useEffect(() => {
    const d = parseISODate(focusedISO);
    setMonthAnchor(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [focusedISO]);

  // The highlighted range: the viewport (focusedISO + bandDays) when given,
  // else the Sunday week containing the focus.
  const bandStart = bandDays
    ? parseISODate(focusedISO)
    : startOfWeekSun(parseISODate(focusedISO));
  const bandLen = bandDays ?? 7;
  const displayedMonth = monthAnchor.getMonth();
  const monthLabel = monthAnchor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const weeks = useMemo(() => {
    const first = startOfWeekSun(monthAnchor); // Sunday on/before the 1st
    return Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)),
    );
  }, [monthAnchor]);

  const shiftMonth = (delta: number) =>
    setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div className="select-none px-2">
      {/* Month label + up/down month nav */}
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[10.8px] font-medium text-text-muted">
          {monthLabel}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => shiftMonth(-1)}
            title="Previous month"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface hover:text-text-muted"
          >
            <ChevronUp width={16} height={16} />
          </button>
          <button
            onClick={() => shiftMonth(1)}
            title="Next month"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface hover:text-text-muted"
          >
            <ChevronDown width={16} height={16} />
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-1 text-center text-[9.9px] font-medium text-text-dim"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="space-y-0.5">
        {weeks.map((week, wi) => {
          // Intersect this row with the highlighted range. Since the main
          // calendar pans freely, the 7-day viewport can straddle two rows —
          // each row draws just its own segment (à la Notion).
          const DAY_MS = 86_400_000;
          const startIdx = Math.round(
            (bandStart.getTime() - week[0].getTime()) / DAY_MS,
          );
          const segFrom = Math.max(0, startIdx);
          const segTo = Math.min(6, startIdx + bandLen - 1);
          const hasBand = segTo >= 0 && segFrom <= 6 && segTo >= segFrom;
          return (
            <div key={wi} className="relative">
              {hasBand && (
                <div
                  className="pointer-events-none absolute inset-y-0 rounded-md"
                  style={{
                    background: "var(--week-band)",
                    left: `${(segFrom / 7) * 100}%`,
                    width: `${((segTo - segFrom + 1) / 7) * 100}%`,
                  }}
                  aria-hidden
                />
              )}
              <div className="relative grid grid-cols-7">
                {week.map((day) => {
                  const iso = toISODate(day);
                  const inMonth = day.getMonth() === displayedMonth;
                  const today = isToday(day);
                  return (
                    <button
                      key={iso}
                      onClick={() => onPickDate(iso)}
                      className="flex aspect-square items-center justify-center"
                    >
                      <span
                        className={cn(
                          "flex aspect-square w-[78%] items-center justify-center rounded-lg text-[11.7px] tabular-nums transition",
                          today
                            ? "bg-accent font-semibold text-white"
                            : inMonth
                              ? "text-text hover:bg-surface-hover"
                              : "text-text-dim hover:bg-surface-hover",
                        )}
                      >
                        {day.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
