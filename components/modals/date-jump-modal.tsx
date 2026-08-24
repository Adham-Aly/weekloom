"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { addDays, cn, fmtFull, fromISODate, toISODate } from "@/lib/utils";
import { parseDateInput } from "@/lib/parse-date";
import { useAutoFocus } from "@/lib/hooks/use-auto-focus";

/**
 * Spotlight-style date jumper. Parses natural language and shows suggestions;
 * Enter (or click) commits, which scrolls the Gantt to that date — extending
 * the visible range if necessary.
 */
export function DateJumpModal({
  open,
  onClose,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  onJump: (iso: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);
  useAutoFocus(inputRef, open);

  const today = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const suggestions = useMemo(() => {
    const parsed = parseDateInput(query);
    const seen = new Set<string>();
    const out: { iso: string; label: string; sub?: string }[] = [];
    function push(iso: string, label: string, sub?: string) {
      if (seen.has(iso)) return;
      seen.add(iso);
      out.push({ iso, label, sub });
    }
    if (parsed) {
      const d = fromISODate(parsed);
      push(parsed, fmtFull(d), "matches your input");
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      push(toISODate(today), "Today", fmtFull(today));
      push(
        toISODate(addDays(today, 1)),
        "Tomorrow",
        fmtFull(addDays(today, 1)),
      );
      push(
        toISODate(addDays(today, 7)),
        "Next week",
        fmtFull(addDays(today, 7)),
      );
      push(
        toISODate(addDays(today, -7)),
        "Last week",
        fmtFull(addDays(today, -7)),
      );
      push(
        toISODate(addDays(today, 30)),
        "In a month",
        fmtFull(addDays(today, 30)),
      );
      return out;
    }

    // Fuzzy: partial month name → suggest a few common days in next 2 occurrences
    const months = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const monthIdx = months.findIndex((m) => m.startsWith(q));
    if (monthIdx >= 0) {
      const monthName =
        months[monthIdx][0].toUpperCase() + months[monthIdx].slice(1);
      const year = today.getFullYear();
      const candidates: { y: number; m: number; d: number }[] = [];
      const firstYear =
        monthIdx > today.getMonth() ||
        (monthIdx === today.getMonth() && today.getDate() < 28)
          ? year
          : year + 1;
      for (const y of [firstYear, firstYear + 1]) {
        for (const day of [1, 5, 10, 15, 20, 25]) {
          candidates.push({ y, m: monthIdx, d: day });
        }
      }
      for (const c of candidates) {
        const date = new Date(c.y, c.m, c.d);
        if (date < today) continue;
        push(toISODate(date), fmtFull(date), `${monthName} ${c.d}, ${c.y}`);
      }
    }

    // Fuzzy: partial weekday → next 4 occurrences
    const weekdays = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const wdIdx = weekdays.findIndex((w) => w.startsWith(q));
    if (wdIdx >= 0) {
      const name = weekdays[wdIdx][0].toUpperCase() + weekdays[wdIdx].slice(1);
      const diff = (wdIdx - today.getDay() + 7) % 7 || 7;
      for (let i = 0; i < 4; i++) {
        const d = addDays(today, diff + i * 7);
        push(toISODate(d), `${i === 0 ? "Next " : ""}${name}`, fmtFull(d));
      }
    }

    // Pure number → upcoming Nth-of-month for the next 6 months
    const numMatch = /^(\d{1,2})$/.exec(q);
    if (numMatch) {
      const day = parseInt(numMatch[1], 10);
      if (day >= 1 && day <= 31) {
        let m = today.getMonth();
        let y = today.getFullYear();
        if (today.getDate() >= day) {
          m += 1;
          if (m > 11) {
            m = 0;
            y += 1;
          }
        }
        for (let i = 0; i < 6; i++) {
          const date = new Date(y, m + i, day);
          if (date.getDate() === day) {
            push(toISODate(date), fmtFull(date), `Day ${day}`);
          }
        }
      }
    }

    return out;
  }, [query, today]);

  function commit(iso?: string) {
    const target = iso ?? suggestions[cursor]?.iso ?? parseDateInput(query);
    if (!target) return;
    onJump(target);
    onClose();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(suggestions.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="text-text-dim"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKey}
          placeholder="Jump to a date"
          className="flex-1 bg-transparent text-sm placeholder:text-text-dim focus:outline-none"
        />
        <kbd className="rounded border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-[9px] text-text-dim">
          ↵
        </kbd>
      </div>

      <div className="max-h-[40vh] overflow-y-auto p-1.5">
        {suggestions.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-text-dim">
            Nothing matches. Try a month, weekday, or date.
          </div>
        ) : (
          suggestions.map((s, i) => (
            <button
              key={s.iso + s.label}
              onClick={() => commit(s.iso)}
              onMouseEnter={() => setCursor(i)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition",
                i === cursor ? "bg-surface" : "hover:bg-surface/60",
              )}
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="shrink-0 text-text-dim"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              <span className="min-w-0 flex-1">
                <div className="truncate text-[11.7px] font-medium text-text">
                  {s.label}
                </div>
                {s.sub && (
                  <div className="truncate text-[9.9px] text-text-dim">
                    {s.sub}
                  </div>
                )}
              </span>
              <span className="shrink-0 font-mono text-[9px] tabular-nums text-text-dim">
                {s.iso}
              </span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
