"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  addDays,
  cn,
  fmtMonthYear,
  fmtFull,
  fromISODate,
  isSameDay,
  toISODate,
} from "@/lib/utils";
import { useEscape } from "@/lib/hooks/use-escape";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

export function DatePicker({
  value,
  onChange,
  className,
  placeholder = "Pick a date",
  autoFocus,
  onKeyDown,
}: {
  value: string; // ISO YYYY-MM-DD
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  // The popover portals to <body> (below). It must be gated on mount so
  // createPortal never runs during SSR — and, crucially, so its fixed
  // positioning resolves against the viewport rather than the Modal card's
  // animated (transformed) box, which would otherwise be its containing block.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (autoFocus) btnRef.current?.focus();
  }, [autoFocus]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left });
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  const outsideRefs = useMemo(() => [popRef, btnRef], []);
  useOutsideClick(outsideRefs, close, open);
  useEscape(close, open);

  const display = value ? fmtFull(fromISODate(value)) : placeholder;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
          onKeyDown?.(e);
        }}
        className={cn(
          "flex w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-left text-[11.7px] transition focus:border-accent focus:outline-none",
          !value && "text-text-dim",
          className,
        )}
      >
        <span>{display}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-text-dim"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {mounted &&
        createPortal(
          // Portal-on-the-outside, AnimatePresence-inside so exits animate; the
          // portal also escapes the Modal card's transform (a fixed child of a
          // transformed ancestor resolves against it, not the viewport).
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={popRef}
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.1, ease: "easeOut" }}
                style={{
                  position: "fixed",
                  top: pos.top,
                  left: pos.left,
                  zIndex: 200,
                  // Frosted glass — matches the calendar's popovers.
                  background: "var(--frost, var(--bg-elev))",
                  backdropFilter: "blur(24px) saturate(180%)",
                  WebkitBackdropFilter: "blur(24px) saturate(180%)",
                  border: "1px solid color-mix(in srgb, var(--text) 12%, transparent)",
                }}
                className="rounded-2xl p-3 shadow-2xl shadow-black/40"
              >
                <CalendarGrid
                  value={value}
                  onSelect={(iso) => {
                    onChange(iso);
                    setOpen(false);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

function CalendarGrid({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (iso: string) => void;
}) {
  const initial = value ? fromISODate(value) : new Date();
  const [cursor, setCursor] = useState(
    new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstWeekday = cursor.getDay(); // 0=Sun
  const monthDays = new Date(
    cursor.getFullYear(),
    cursor.getMonth() + 1,
    0,
  ).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= monthDays; d++)
    cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="w-[240px]">
      <div className="mb-2 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
          }
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface hover:text-text"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <span className="text-[10.8px] font-medium text-text-muted">
          {fmtMonthYear(cursor)}
        </span>
        <button
          type="button"
          onClick={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
          }
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface hover:text-text"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div
            key={i}
            className="text-center text-[9.9px] font-medium text-text-dim"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) =>
          d ? (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(toISODate(d))}
              className={cn(
                "rounded-lg py-1 text-center text-[9.9px] tabular-nums transition",
                value === toISODate(d)
                  ? "bg-accent text-white"
                  : isSameDay(d, today)
                    ? "bg-surface text-accent font-semibold hover:bg-surface-hover"
                    : "text-text-muted hover:bg-surface-hover hover:text-text",
              )}
            >
              {d.getDate()}
            </button>
          ) : (
            <div key={i} />
          ),
        )}
      </div>

      <div
        className="mt-2 flex justify-end gap-2 pt-2"
        style={{ borderTop: "1px solid color-mix(in srgb, var(--text) 8%, transparent)" }}
      >
        <button
          type="button"
          onClick={() => onSelect(toISODate(today))}
          className="rounded-md px-2 py-1 text-[9.9px] text-text-muted hover:bg-surface hover:text-text"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => onSelect(toISODate(addDays(today, 1)))}
          className="rounded-md px-2 py-1 text-[9.9px] text-text-muted hover:bg-surface hover:text-text"
        >
          Tomorrow
        </button>
      </div>
    </div>
  );
}
