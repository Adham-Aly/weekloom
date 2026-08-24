"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn, fmtTime12, parseFlexTime } from "@/lib/utils";
import { useEscape } from "@/lib/hooks/use-escape";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import type { Block } from "@/lib/types/database";
import { BlockSelect } from "@/components/ui/block-select";

/**
 * Calendar event editor — a Notion-style frosted panel. The card's name is the
 * headline; time, block, and effort read as calm rows below it.
 */
export function EventEditPopover({
  anchorRef,
  itemTitle,
  stepLabel,
  blockName,
  blockColor,
  blocks,
  currentBlockId,
  time,
  durationMin,
  isDone,
  isRecurring,
  onTimeChange,
  onDurationChange,
  onLabelChange,
  onTitleChange,
  onBlockChange,
  onAddAnother,
  onToggleDone,
  onDelete,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  itemTitle: string;
  stepLabel: string;
  blockName?: string;
  blockColor?: string;
  blocks?: Block[];
  currentBlockId?: string;
  time: string | null;
  durationMin: number | null;
  isDone: boolean;
  /** The parent item repeats — shows a "Repeats" row. */
  isRecurring?: boolean;
  onTimeChange: (t: string | null) => void;
  onDurationChange: (m: number | null) => void;
  onLabelChange?: (label: string) => void;
  onTitleChange?: (title: string) => void;
  onBlockChange?: (blockId: string) => void;
  /** Gantt: add a SECOND timed occurrence of this step on the same day
   *  (repeat), instead of changing this one's time. Renders a quiet
   *  "Add another time" row (only once a time exists). */
  onAddAnother?: (time: string) => void;
  onToggleDone: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [timeDraft, setTimeDraft] = useState(fmtTime12(time) ?? "");
  const [effortDraft, setEffortDraft] = useState(durationMin?.toString() ?? "");
  const [labelDraft, setLabelDraft] = useState(stepLabel);
  const [titleDraft, setTitleDraft] = useState(itemTitle);
  // "Add another time" row: null = idle button, string = inline time draft.
  const [addDraft, setAddDraft] = useState<string | null>(null);

  const W = 270;
  const nonSystemBlocks = blocks?.filter((b) => !b.is_system) ?? [];

  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const estimatedH = 440;
    let left = r.right + 10;
    if (left + W > window.innerWidth - 8) left = r.left - W - 10;
    left = Math.max(8, left);
    const top = Math.min(
      window.innerHeight - estimatedH - 8,
      Math.max(8, r.top),
    );
    setPos({ top, left });
  }, [anchorRef]);

  // The DB stores "HH:MM:SS"; every client surface writes "HH:MM". Compare on
  // the normalized form — the raw comparison was never equal, so merely
  // focusing and blurring the time field issued a no-op write, bumping
  // `updated_at` for nothing.
  const timeHM = time ? time.slice(0, 5) : null;

  function commitTime() {
    if (timeDraft.trim() === "") {
      if (time !== null) onTimeChange(null);
    } else {
      const parsed = parseFlexTime(timeDraft);
      if (parsed && parsed !== timeHM) onTimeChange(parsed);
    }
  }
  // ⚠️ Clamped at 1440 for the reason spelled out on `step-row.tsx`'s
  // `commitEffort`: `stepUpdateSchema` rejects a larger `duration_min`, and a
  // rejected write is logged and dropped with no rollback, so an unclamped
  // value is lost silently rather than reported. This editor and the step row
  // are the same control drawn twice; they must agree.
  function commitEffort() {
    const n = parseInt(effortDraft, 10);
    if (effortDraft === "") {
      if (durationMin !== null) onDurationChange(null);
    } else if (!isNaN(n) && n >= 0) {
      const clamped = Math.min(n, 1440);
      if (clamped !== durationMin) onDurationChange(clamped);
      if (String(clamped) !== effortDraft) setEffortDraft(String(clamped));
    }
  }
  function commitLabel() {
    if (onLabelChange && labelDraft !== stepLabel) onLabelChange(labelDraft);
  }
  function commitTitle() {
    const next = titleDraft.trim();
    // An item can't be nameless — revert instead of saving an empty title.
    if (next === "") {
      setTitleDraft(itemTitle);
      return;
    }
    if (onTitleChange && next !== itemTitle) onTitleChange(next);
  }

  /**
   * Flush every typed-but-uncommitted draft, then close. The inputs commit on
   * blur, but a dismissal can unmount them WITHOUT a blur ever firing — Escape,
   * or an outside pointerdown whose target prevents default (calendar cards
   * do, to arm drags) — so "type a new time, click elsewhere" silently threw
   * the edit away. Every dismissal path routes through here now; the commit
   * fns are diffed against props, so an already-blurred field is a no-op.
   */
  const flushAndClose = () => {
    commitTime();
    commitEffort();
    commitLabel();
    commitTitle();
    onClose();
  };

  const outsideRefs = useMemo(() => [popRef, anchorRef], [anchorRef]);
  useOutsideClick(outsideRefs, flushAndClose);
  useEscape(flushAndClose);

  if (!pos) return null;
  if (typeof document === "undefined") return null;

  const accent = blockColor ?? "var(--accent)";
  const endLabel =
    time && durationMin
      ? fmtTime12(addMinutes(time, durationMin))
      : null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={popRef}
        // The popover mounts inside the calendar grid's DOM, whose
        // pointerdown handlers capture the pointer (drag-to-create, lasso).
        // Without this, that capture swallows every click in here.
        onPointerDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.97, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -6 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          zIndex: 200,
          width: W,
          // Frosted glass: translucent elevated bg + heavy blur behind it.
          background: "var(--frost, var(--bg-elev))",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid color-mix(in srgb, var(--text) 12%, transparent)",
        }}
        className="overflow-hidden rounded-2xl shadow-2xl shadow-black/40"
      >
        {/* ── Header: name + close ── */}
        <div className="relative px-4 pt-3.5 pb-3">
          <button
            onClick={flushAndClose}
            aria-label="Close"
            className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          {/* Card name — the headline edit. Falls back to the task title as a
              ghost, mirroring what the card itself displays. */}
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder={itemTitle || "Add a name…"}
            className={cn(
              "w-full bg-transparent pr-7 text-[14.4px] font-semibold leading-snug placeholder:text-text-dim/60 focus:outline-none",
              isDone && "text-text-dim line-through",
            )}
          />
        </div>

        {/* ── Rows ── */}
        <div className="space-y-0.5 px-2 pb-2">
          {/* Time */}
          <Row icon={<ClockIcon />}>
            <input
              value={timeDraft}
              onChange={(e) => setTimeDraft(e.target.value)}
              onBlur={commitTime}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="Set a time"
              className="w-full min-w-0 bg-transparent text-[11.7px] tabular-nums text-text placeholder:text-text-dim focus:outline-none"
            />
            {endLabel && (
              <span className="shrink-0 whitespace-nowrap text-[10.8px] tabular-nums text-text-dim">
                → {endLabel}
              </span>
            )}
          </Row>

          {/* Effort */}
          <Row icon={<GaugeIcon />}>
            <div className="flex w-full items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={effortDraft}
                onChange={(e) =>
                  setEffortDraft(e.target.value.replace(/[^0-9]/g, ""))
                }
                onBlur={commitEffort}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                placeholder="Effort"
                className="min-w-0 flex-1 bg-transparent text-[11.7px] tabular-nums text-text placeholder:text-text-dim focus:outline-none"
              />
              <span className="shrink-0 text-[9.9px] text-text-dim">min</span>
            </div>
          </Row>

          {/* Repeats */}
          {isRecurring && (
            <Row icon={<RepeatIcon />}>
              <span className="text-[11.7px] text-text-muted">Repeats</span>
            </Row>
          )}

          {/* Add another occurrence (gantt) — same icon-led row idiom. Only
              offered once a time exists (a TBD step has nothing to repeat). */}
          {onAddAnother &&
            time &&
            (addDraft === null ? (
              <button
                type="button"
                onClick={() => setAddDraft("")}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface/60"
              >
                <span className="shrink-0 text-text-dim">
                  <PlusIcon />
                </span>
                <span className="text-[11.7px] text-text-dim">
                  Add another time
                </span>
              </button>
            ) : (
              <Row icon={<PlusIcon />}>
                <input
                  autoFocus
                  value={addDraft}
                  onChange={(e) => setAddDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const parsed = parseFlexTime(addDraft);
                      if (parsed) {
                        onAddAnother(parsed);
                        onClose();
                      }
                    } else if (e.key === "Escape") {
                      // Collapse the row, not the whole popover.
                      e.stopPropagation();
                      setAddDraft(null);
                    }
                  }}
                  onBlur={() => setAddDraft(null)}
                  placeholder="e.g. 9:30 AM"
                  className="w-full min-w-0 bg-transparent text-[11.7px] tabular-nums text-text placeholder:text-text-dim focus:outline-none"
                />
              </Row>
            ))}
        </div>

        {/* ── Block selector (Notion-style dropdown) ── */}
        {nonSystemBlocks.length > 0 && onBlockChange && (
          <div className="px-2 pb-2">
            <BlockSelect
              blocks={nonSystemBlocks}
              currentBlockId={currentBlockId}
              onChange={onBlockChange}
            />
          </div>
        )}

        {/* ── Task subtitle (editable when a handler is wired; otherwise a
            read-only context line — an editable-looking input that silently
            discards on blur would be a trap) ── */}
        <div className="px-4 pb-3 pt-0.5">
          <input
            value={titleDraft}
            readOnly={!onTitleChange}
            tabIndex={onTitleChange ? undefined : -1}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="Task name"
            className={cn(
              "w-full bg-transparent text-[10.3px] text-text-dim placeholder:text-text-dim/60 focus:outline-none",
              !onTitleChange && "cursor-default select-none",
            )}
          />
        </div>

        {/* ── Actions ── */}
        <div
          className="flex items-center gap-2 px-3 py-2.5"
          style={{ borderTop: "1px solid color-mix(in srgb, var(--text) 8%, transparent)" }}
        >
          <button
            onClick={onToggleDone}
            className={cn(
              "flex flex-1 items-center justify-center rounded-lg py-2 text-[10.8px] font-semibold transition",
              isDone
                ? "bg-surface text-text hover:bg-surface-hover"
                : "text-white hover:brightness-110",
            )}
            style={isDone ? {} : { background: accent }}
          >
            {isDone ? "Restore" : "Mark done"}
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg p-2 text-text-dim transition hover:bg-surface hover:text-deadline"
            title="Delete step"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

/** A quiet icon-led row, the Notion editor idiom. */
function Row({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-surface/60">
      <span className="shrink-0 text-text-dim">{icon}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

function addMinutes(time24: string, min: number): string {
  const [h, m] = time24.split(":").map(Number);
  const total = (h * 60 + m + min) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ── Icons ────────────────────────────────────────────────────────────────────

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M12 14 8.5 8.5" />
      <path d="M3.5 18a9 9 0 1 1 17 0" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
