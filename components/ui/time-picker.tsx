"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn, fmtTime12, parseFlexTime } from "@/lib/utils";
import { useEscape } from "@/lib/hooks/use-escape";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

export { parseFlexTime };

const POP_W = 223;

/** Floating time-picker popover anchored to an element. */
export function TimePopover({
  anchorRef,
  value,
  onSelect,
  onAddAnother,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  value: string | null;
  onSelect: (time: string | null) => void;
  /** When provided, shows an "Add another time" affordance that adds a SECOND
   *  timed occurrence on the same day instead of changing this one's time. */
  onAddAnother?: (time: string) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [custom, setCustom] = useState(fmtTime12(value) ?? "");
  // When true the picker is choosing a time for a NEW occurrence (repeat),
  // not editing this step's time.
  const [adding, setAdding] = useState(false);

  // Open directly under the block, but flip ABOVE when it would overflow the
  // bottom, then clamp fully into the viewport — so it can never spawn off
  // screen / get lost under a sticky edge, wherever the user clicked.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    const pop = popRef.current;
    if (!a || !pop) return;
    const r = a.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const popH = pop.offsetHeight;
    const left = Math.min(
      window.innerWidth - POP_W - margin,
      Math.max(margin, r.left),
    );
    let top = r.bottom + gap;
    if (top + popH > window.innerHeight - margin) {
      const above = r.top - gap - popH;
      top =
        above >= margin
          ? above
          : Math.max(margin, window.innerHeight - popH - margin);
    }
    setPos({ top, left });
  }, [anchorRef, value, adding]);

  const outsideRefs = useMemo(() => [popRef, anchorRef], [anchorRef]);
  useOutsideClick(outsideRefs, onClose);
  useEscape(onClose);

  // Route a chosen time: in "add another" mode it creates a new occurrence;
  // otherwise it sets this step's time.
  function pick(time: string) {
    if (adding) onAddAnother?.(time);
    else onSelect(time);
    onClose();
  }

  function submitCustom() {
    const parsed = parseFlexTime(custom);
    if (parsed) pick(parsed);
  }

  const quick = [
    "7:00 AM",
    "8:00 AM",
    "9:00 AM",
    "10:00 AM",
    "11:00 AM",
    "12:00 PM",
    "1:00 PM",
    "2:00 PM",
    "3:00 PM",
    "5:00 PM",
    "7:00 PM",
    "9:00 PM",
  ];

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={popRef}
        // Rendered inside surfaces with pointer-capturing drag handlers
        // (calendar grid) — keep presses from leaking into them, or the
        // capture swallows this popover's clicks.
        onPointerDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.97, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -4 }}
        transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: "fixed",
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          zIndex: 60,
          width: POP_W,
          // Hidden until measured & positioned so it never flashes off-screen.
          visibility: pos ? "visible" : "hidden",
          // Frosted glass — matches the edit / create / external popovers.
          background: "var(--frost, var(--bg-elev))",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid color-mix(in srgb, var(--text) 12%, transparent)",
        }}
        className="overflow-hidden rounded-2xl p-3 shadow-2xl shadow-black/40"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface hover:text-text"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="flex items-center gap-1.5 px-0.5 pb-2 pr-6">
          {adding && (
            <button
              onClick={() => setAdding(false)}
              aria-label="Back"
              className="-ml-0.5 flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface hover:text-text"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <span className="text-[9.9px] font-semibold tracking-tight text-text-muted">
            {adding ? "Add another time" : "Set time"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {quick.map((t) => {
            // Highlight the step's current time (edit mode only) with the
            // active accent; every other option stays neutral-at-rest, the
            // app-wide "pick one of several" idiom (calendar day-toggle).
            const active =
              !adding && value !== null && parseFlexTime(t) === value;
            return (
              <button
                key={t}
                onClick={() => pick(parseFlexTime(t)!)}
                aria-pressed={active}
                className={cn(
                  "rounded-lg py-1.5 text-[10.8px] font-medium tabular-nums transition",
                  active
                    ? "bg-accent text-white"
                    : "bg-surface text-text-muted hover:bg-surface-hover hover:text-text",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
        <div className="mt-2.5 flex items-stretch gap-1.5">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCustom();
            }}
            placeholder="e.g. 9:30 AM, 14:00"
            autoFocus
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-[11.7px] placeholder:text-text-dim focus:border-accent focus:outline-none"
          />
          {/* No fixed height — stretch to the input's height so the two always
              match, even where a fixed h-9 resolves differently per browser. */}
          <button
            onClick={submitCustom}
            className="inline-flex shrink-0 items-center justify-center self-stretch rounded-lg bg-accent px-3.5 text-[10.8px] font-semibold leading-none text-white transition hover:brightness-110"
          >
            {adding ? "Add" : "Set"}
          </button>
        </div>
        {/* Bottom actions (edit mode only). "Add another time" only makes
            sense once a time exists, so it's gated on `value` — a TBD cell
            with no time shows neither. Add-another sits above Clear. In
            add-another mode the header back-button is the way out. */}
        {!adding && value && onAddAnother && (
          <button
            onClick={() => {
              setCustom("");
              setAdding(true);
            }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong py-1.5 text-[10.8px] font-medium text-text-muted transition hover:border-accent/50 hover:text-text"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add another time
          </button>
        )}
        {!adding && value && (
          <button
            onClick={() => {
              onSelect(null);
              onClose();
            }}
            className="mt-1.5 w-full rounded-lg py-1.5 text-[10.8px] font-medium text-text-muted transition hover:bg-surface hover:text-deadline"
          >
            Clear time
          </button>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

/** Render a colored time chip — AM = light blue, PM = orange. */
export function TimeChip({
  time,
  color,
  className,
  small,
}: {
  time: string | null | undefined;
  color?: string;
  className?: string;
  small?: boolean;
}) {
  const t = fmtTime12(time);
  if (!t) return null;
  return (
    <span
      className={cn(
        "inline-block rounded-full font-medium tabular-nums",
        small ? "px-1.5 py-0.5 text-[8.6px]" : "px-2 py-0.5 text-[9.5px]",
        className,
      )}
      style={
        color
          ? {
              background: `color-mix(in srgb, ${color} 22%, transparent)`,
              color,
            }
          : { background: "var(--surface)", color: "var(--text-muted)" }
      }
    >
      {t}
    </span>
  );
}
