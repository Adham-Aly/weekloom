"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { Item, Step } from "@/lib/types/database";
import { cn, daysBetween, fmtTime12 } from "@/lib/utils";
import { TimeChip } from "@/components/ui/time-picker";
import { EventEditPopover } from "@/components/ui/event-edit-popover";
import { useMenu } from "@/components/ui/context-menu";
import {
  MAX_ROW_H,
  MIN_ROW_H,
  type CellPointerInit,
  type ChipMode,
} from "@/lib/gantt/constants";
import { focusSiblingCol, navigateInputs } from "@/lib/gantt/dom-nav";
import { useResizeDrag } from "@/lib/hooks/use-resize-drag";
import { useIsDarkTheme } from "@/lib/hooks/use-is-dark-theme";

/**
 * A single step row inside an item. Owns its own label/effort drafts,
 * row-height drag, and time popover.
 *
 * Wrapped in React.memo so that typing inside one step doesn't re-render
 * every other step in the same item. The parent passes id-stable callbacks
 * (board-level functions that take the step id) so memo equality holds.
 */
export const StepRow = memo(function StepRow({
  step,
  item,
  color,
  days,
  colW,
  rangeStartISO,
  gridWidth,
  rowH,
  setRowH,
  chipMode,
  isSelected,
  selectionSource = "timeline",
  isCopied = false,
  isPrevSelected = false,
  isNextSelected = false,
  isPrevCopied = false,
  isNextCopied = false,
  compact = false,
  deadlineOffset,
  isDeadlineSelected,
  onCellPointerDown,
  onClearSelection,
  onRecordCellAnchor,
  onUpdateStep,
  onRepeatStep,
  onToggleStepDone,
  onDeleteStep,
  onSwapSteps,
  deadlineDragDelta,
  onDeadlinePointerDown,
  onDeadlinePointerMove,
  onDeadlinePointerUp,
}: {
  step: Step;
  item: Item;
  color: string;
  days: Date[];
  colW: number;
  rangeStartISO: string;
  gridWidth: number;
  rowH: number;
  setRowH: (h: number) => void;
  chipMode: ChipMode;
  isSelected: boolean;
  /** Where the click that built this selection landed.
   *  "timeline" → ring the cell button. "sidebar" → outline the
   *  sidebar row. Mutually exclusive. */
  selectionSource?: "timeline" | "sidebar";
  /** This step's labels are in the ⌘C clipboard set — render a
   *  dashed border to mirror Excel's marching-ants outline. */
  isCopied?: boolean;
  /** Adjacency hints so a run of selected/copied rows collapses to a
   *  single unified outline (no internal horizontal seams). */
  isPrevSelected?: boolean;
  isNextSelected?: boolean;
  isPrevCopied?: boolean;
  isNextCopied?: boolean;
  /** Compact sidebar: hide drag handle + chip/effort column. Used on
   *  mobile and in desktop day-focus mode where horizontal space is at
   *  a premium and the label alone is enough context. */
  compact?: boolean;
  /** Column offset (relative to item.start_date) where the deadline cell lives. -1 = none. */
  deadlineOffset: number;
  isDeadlineSelected: boolean;
  onCellPointerDown: (
    itemId: string,
    stepId: string,
    e: CellPointerInit,
    source?: "timeline" | "sidebar",
  ) => void;
  /** Drop the current cells/items selection (and copied marching
   *  outline) — fired when the user plain-clicks a step that isn't
   *  in the current selection, so the prior multi-row outline goes
   *  away as they shift focus elsewhere. */
  onClearSelection: () => void;
  /** Stamp the anchor cell — called on every plain click so a follow-
   *  up shift-click paints range from this cell. */
  onRecordCellAnchor: (itemId: string, stepId: string) => void;
  onUpdateStep: (id: string, patch: Partial<Step>) => void;
  /** Add another timed occurrence of this task on the same day. */
  onRepeatStep: (source: Step, time: string) => void;
  onToggleStepDone: (s: Step) => void;
  onDeleteStep: (s: Step) => void;
  onSwapSteps: (a: string, b: string) => void;
  /** Live day-delta while this item's deadline is being dragged (0 when not). */
  deadlineDragDelta: number;
  onDeadlinePointerDown: (e: React.PointerEvent) => void;
  onDeadlinePointerMove: (e: React.PointerEvent) => void;
  onDeadlinePointerUp: (e: React.PointerEvent) => void;
}) {
  const onUpdate = (patch: Partial<Step>) => onUpdateStep(step.id, patch);
  const onToggleDone = () => onToggleStepDone(step);
  const onDelete = () => onDeleteStep(step);
  const isDark = useIsDarkTheme();
  const [draft, setDraft] = useState(step.label);
  const [dragOver, setDragOver] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  // Two-phase completion animation: strikethrough fires immediately,
  // then the row fades out, then the real toggle fires.
  const [completing, setCompleting] = useState(false);
  const [fading, setFading] = useState(false);

  function handleCheckboxClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (isDone) {
      onToggleDone();
      return;
    }
    if (completing) return;
    setCompleting(true);
    setTimeout(() => setFading(true), 150);
    setTimeout(() => onToggleDone(), 550);
  }
  const cellRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(step.label), [step.label]);

  const dayIdx = daysBetween(rangeStartISO, item.start_date) + step.day_offset;
  const inRange = dayIdx >= 0 && dayIdx < days.length;
  const isDone = step.status === "done";
  const cellLeft = inRange ? dayIdx * colW + 3 : 0;
  const cellWidth = inRange ? colW - 6 : 0;

  // Deadline column — derived from effectiveDeadlineOffset in parent.
  const deadlineDayIdx =
    deadlineOffset >= 0
      ? daysBetween(rangeStartISO, item.start_date) + deadlineOffset
      : -1;
  const deadlineInRange =
    deadlineOffset >= 0 && deadlineDayIdx >= 0 && deadlineDayIdx < days.length;
  const deadlineLeft = deadlineInRange ? deadlineDayIdx * colW + 3 : 0;
  const deadlineWidth = deadlineInRange ? colW - 6 : 0;
  // When the deadline lands on the same column as this step, render a slim
  // right-edge indicator instead of the full chip to avoid text overlap.
  const deadlineOnThisStep = deadlineInRange && deadlineDayIdx === dayIdx;

  const time12 = fmtTime12(step.time_of_day) ?? "";
  const timeIsAM = time12.endsWith("AM");

  // Effort
  const [effortDraft, setEffortDraft] = useState(
    step.duration_min?.toString() ?? "",
  );
  useEffect(() => {
    setEffortDraft(step.duration_min?.toString() ?? "");
  }, [step.duration_min]);
  /**
   * ⚠️ **Clamped at 1440 minutes, and the clamp is the whole point.**
   *
   * `stepUpdateSchema` bounds `duration_min` to 1440, and `persist()` logs a
   * rejected write and does NOT roll back — so an unclamped value does not
   * fail loudly, it fails invisibly: MEASURED, typing `2000` here returned
   * HTTP 500 (`ActionError: Too big: expected number to be <=1440`), left
   * `2000` on screen, and produced the previous value again after a reload.
   * The estimate the person typed was gone with nothing in the interface
   * saying so, and an extra digit is all it takes.
   *
   * Clamping rather than reporting is what the other two writers of this same
   * column already do — the cells-paste path in `board.tsx` and
   * `calendar.tsx`'s resize — and it matches the house rule that a component
   * never raises a toast. The field snaps to 1440 in front of the person, so
   * the feedback is the value itself.
   *
   * The draft is resynced explicitly because a clamp that lands on the value
   * already stored issues no write, so nothing else would ever correct the
   * text still sitting in the input.
   */
  function commitEffort() {
    const n = parseInt(effortDraft, 10);
    if (effortDraft === "") {
      if (step.duration_min !== null) onUpdate({ duration_min: null });
    } else if (!isNaN(n) && n >= 0) {
      // The literal, not a shared constant: `board.tsx`'s paste path and
      // `calendar.tsx`'s resize both spell it out too, and a constant covering
      // three of the five places this bound appears would read as authoritative
      // while two writers and the schema still carried their own.
      const clamped = Math.min(n, 1440);
      if (clamped !== step.duration_min) onUpdate({ duration_min: clamped });
      if (String(clamped) !== effortDraft) setEffortDraft(String(clamped));
    }
  }

  function commitLabel() {
    if (draft !== step.label) onUpdate({ label: draft });
  }
  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const inp = e.target as HTMLInputElement;
    const atEnd =
      (inp.selectionEnd ?? 0) === inp.value.length &&
      (inp.selectionStart ?? 0) === inp.value.length;
    if (
      e.key === "Enter" ||
      (e.key === "Tab" && !e.shiftKey) ||
      e.key === "ArrowDown"
    ) {
      e.preventDefault();
      commitLabel();
      navigateInputs("label", step.id, 1);
    } else if ((e.key === "Tab" && e.shiftKey) || e.key === "ArrowUp") {
      e.preventDefault();
      commitLabel();
      navigateInputs("label", step.id, -1);
    } else if (e.key === "ArrowRight" && atEnd) {
      e.preventDefault();
      commitLabel();
      focusSiblingCol(step.id, "effort");
    } else if (e.key === "Escape") {
      inputRef.current?.blur();
    }
  }

  const menu = useMenu(() => [
    { label: "Focus label", onClick: () => inputRef.current?.focus() },
    { label: isDone ? "Mark not done" : "Mark done", onClick: onToggleDone },
    {
      label: step.time_of_day ? "Edit time…" : "Set time…",
      onClick: () => setTimeOpen(true),
    },
    ...(step.time_of_day
      ? [
          {
            label: "Clear time",
            onClick: () => onUpdate({ time_of_day: null }),
          },
        ]
      : []),
    { type: "separator" as const },
    { label: "Delete step", destructive: true, onClick: onDelete },
  ]);

  // Spreadsheet-style row-height drag: horizontal guideline tracks the
  // cursor during drag, commit-on-release. No re-renders mid-drag.
  const heightDrag = useResizeDrag({
    axis: "y",
    min: MIN_ROW_H,
    max: MAX_ROW_H,
    onCommit: setRowH,
  });

  return (
    <div
      {...menu}
      className={cn(
        "group relative flex items-stretch",
        dragOver && "bg-accent/10",
      )}
      style={{
        height: rowH,
        width: `calc(var(--sidebar-w) + ${gridWidth}px)`,
        opacity: fading ? 0 : 1,
        transition: fading ? "opacity 0.35s ease" : undefined,
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/item-id")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const otherId = e.dataTransfer.getData("text/step-id");
        const otherItemId = e.dataTransfer.getData("text/item-id");
        if (otherId && otherId !== step.id && otherItemId === step.item_id) {
          onSwapSteps(step.id, otherId);
        }
      }}
    >
      <div
        className="sticky left-0 z-50 flex h-full items-center gap-1.5 bg-bg pr-2 pl-[54px]"
        data-gantt-sidebar=""
        data-step-sidebar=""
        data-step-row-id={step.id}
        data-step-copied={isCopied ? "" : undefined}
        style={{
          width: "var(--sidebar-w)",
          overflow: "hidden",
          // NOTE: do NOT set position here. The className sets `sticky left-0`
          // so this sidebar label stays frozen during horizontal pan (matching
          // block/item headers). An inline `position: relative` here used to
          // override that sticky → the label drifted/clipped on scroll. `sticky`
          // is itself a positioned element, so it still serves as the containing
          // block for the absolutely-positioned selection overlay + drag handle.
          borderRight: "1px solid var(--border)",
        }}
        // mousedown CAPTURE so we run BEFORE the input's native
        // focus + text-selection. A bubble-phase pointerdown is too
        // late: by the time it fires, the browser has already given
        // the input focus and (on shift-click) painted a text
        // selection inside it, so calling preventDefault is a no-op
        // for the focus and the cell-level selection never wins.
        onMouseDownCapture={(e) => {
          if (e.button !== 0) return;
          const t = e.target as HTMLElement;
          if (t.closest("[data-no-cell-select]")) return;

          // Shift / ⌘ / Ctrl: take over completely. preventDefault
          // (in capture) suppresses both the input's focus and its
          // text-selection-extend default. stopPropagation keeps the
          // gantt body's own clear-selection from firing.
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            (document.activeElement as HTMLElement | null)?.blur?.();
            const fakeMod: CellPointerInit = {
              button: 0,
              shiftKey: e.shiftKey,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
            };
            onCellPointerDown(item.id, step.id, fakeMod, "sidebar");
            return;
          }

          // Plain click → stamp this cell as the anchor so a follow-
          // up shift-click anywhere paints range from here.
          onRecordCellAnchor(item.id, step.id);
          // Plain click on ANY cell (inside or outside the current
          // selection) drops the painted selection. The user just
          // shifted focus to a single cell — keeping a stale range
          // around it is confusing. Marching ants from ⌘C survive
          // this (that's a separate state).
          onClearSelection();

          // Drag-select arming. If the pointer moves >4px before
          // pointerup we treat it as a drag and brush across rows;
          // a click that doesn't move is a normal "edit this cell".
          const startX = e.clientX;
          const startY = e.clientY;
          let dragging = false;
          const visited = new Set<string>();
          function maybeStartDrag(ev: PointerEvent) {
            const dx = Math.abs(ev.clientX - startX);
            const dy = Math.abs(ev.clientY - startY);
            if (!dragging && dx + dy > 4) {
              dragging = true;
              (document.activeElement as HTMLElement | null)?.blur?.();
              const fakeStart: CellPointerInit = {
                button: 0,
                shiftKey: false,
                metaKey: false,
                ctrlKey: false,
              };
              onCellPointerDown(item.id, step.id, fakeStart, "sidebar");
              visited.add(step.id);
            }
            if (!dragging) return;
            const el = document.elementFromPoint(ev.clientX, ev.clientY);
            const row = (el as HTMLElement | null)?.closest(
              "[data-step-row-id]",
            ) as HTMLElement | null;
            const sid = row?.dataset.stepRowId;
            if (!sid || visited.has(sid)) return;
            visited.add(sid);
            const fakeExtend: CellPointerInit = {
              button: 0,
              shiftKey: true,
              metaKey: false,
              ctrlKey: false,
            };
            onCellPointerDown(item.id, sid, fakeExtend, "sidebar");
          }
          function onUp() {
            window.removeEventListener("pointermove", maybeStartDrag);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
          }
          window.addEventListener("pointermove", maybeStartDrag);
          window.addEventListener("pointerup", onUp);
          window.addEventListener("pointercancel", onUp);
        }}
      >
        {/* Selection / copied outline overlay.
         *  Inset from the row edges so it floats inside the row
         *  (matching the elegant per-cell ring style). Top/bottom
         *  corner rounding is suppressed when the neighbouring row
         *  is also in the same state so a contiguous run reads as
         *  one continuous rounded outline. Borders on top/bottom
         *  are dropped at the same time so adjacent overlays share
         *  one seamless perimeter. */}
        {/* SELECTION overlay (active highlight): low-opacity accent
         *  fill + solid 2px border. Render only when the click that
         *  built this selection landed on the sidebar — a timeline-
         *  click selection paints the cell ring instead (see the
         *  cell button below). Adjacency hints suppress internal
         *  seams so a contiguous selected run reads as one rounded
         *  outline. */}
        {isSelected && selectionSource === "sidebar" && (
          <div
            className="pointer-events-none absolute"
            aria-hidden
            style={{
              left: 4,
              right: 4,
              top: !isPrevSelected ? 2 : 0,
              bottom: !isNextSelected ? 2 : 0,
              background: "color-mix(in srgb, var(--accent) 14%, transparent)",
              borderLeft: "2px solid var(--accent)",
              borderRight: "2px solid var(--accent)",
              borderTop: !isPrevSelected
                ? "2px solid var(--accent)"
                : undefined,
              borderBottom: !isNextSelected
                ? "2px solid var(--accent)"
                : undefined,
              borderTopLeftRadius: !isPrevSelected ? 8 : 0,
              borderTopRightRadius: !isPrevSelected ? 8 : 0,
              borderBottomLeftRadius: !isNextSelected ? 8 : 0,
              borderBottomRightRadius: !isNextSelected ? 8 : 0,
            }}
          />
        )}

        {/* COPIED overlay: exact same shape/positioning as the
         *  selection overlay above, just border-style: dashed
         *  instead of solid and no fill. The `marching-ants` class
         *  paints animated gradient stripes on each edge that move
         *  clockwise — sits ON TOP of the static dashed border, so
         *  if the animation ever fails to paint, the user still
         *  sees the dashed outline. */}
        {isCopied && (
          <div
            className="marching-ants pointer-events-none absolute"
            aria-hidden
            style={
              {
                left: 4,
                right: 4,
                top: !isPrevCopied ? 2 : 0,
                bottom: !isNextCopied ? 2 : 0,
                // No CSS border — the animated background-image
                // stripes ARE the visual. The static dashed border
                // doubled the thickness and never moved; the stripes
                // alone give a clean, marching outline.
                borderTopLeftRadius: !isPrevCopied ? 8 : 0,
                borderTopRightRadius: !isPrevCopied ? 8 : 0,
                borderBottomLeftRadius: !isNextCopied ? 8 : 0,
                borderBottomRightRadius: !isNextCopied ? 8 : 0,
                // Suppress marching-ants stripes on edges shared with
                // another copied row so the seam doesn't double-paint.
                "--ants-top": !isPrevCopied ? "12px 2px" : "0 0",
                "--ants-bot": !isNextCopied ? "12px 2px" : "0 0",
                "--ants-left": "2px 12px",
                "--ants-right": "2px 12px",
              } as React.CSSProperties
            }
          />
        )}

        {/* Drag handle is absolutely positioned so it overlays the
         *  pl-11 gutter on hover without ever shifting the label's
         *  resting x. The label always sits at the same column as the
         *  item-title above it. */}
        {!compact && (
          /* Checkbox doubles as drag handle: click = toggle done,
           * drag = reorder (same dataTransfer as the old dots).      */
          <span
            data-no-cell-select=""
            className="pointer-events-auto absolute top-1/2 left-[15px] -translate-y-1/2 transition"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/step-id", step.id);
              e.dataTransfer.setData("text/item-id", step.item_id);
            }}
            onClick={handleCheckboxClick}
            title={isDone ? "Mark not done" : "Mark done"}
          >
            <span
              className="flex h-[15px] w-[15px] cursor-pointer items-center justify-center rounded-md transition-all duration-150 hover:[filter:saturate(1.7)]"
              style={
                isDone || completing
                  ? // Done: solid fill, white check.
                    { background: color, color: "#fff" }
                  : // Not done: thin solid low-opacity tint, full-colour check —
                    // no border, so it reads distinctly lighter than the solid
                    // "+" square next to it.
                    {
                      background: `color-mix(in srgb, ${color} 18%, transparent)`,
                      color,
                    }
              }
            >
              {/* Always-present elegant check (thin, round) — the fill state
                  communicates done/not-done, not the check's presence. */}
              <svg
                width="9"
                height="9"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 6.25l2.25 2.25L9.5 3.75" />
              </svg>
            </span>
          </span>
        )}

        {/* Always-input label */}
        <input
          ref={inputRef}
          data-step-label={item.id}
          data-step-id={step.id}
          data-nav-col="label"
          data-nav-row={step.id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={handleInputKey}
          placeholder="Add detail"
          className={cn(
            "flex-1 truncate bg-transparent text-[12.2px] placeholder:text-text-dim/60 focus:outline-none transition-all duration-150",
            (isDone || completing) && "text-text-dim line-through",
          )}
        />

        {/* T/E chip area: time chip (T mode) or effort input (E mode).
         *  Hidden in compact mode (mobile / day-focus) to give the label
         *  the entire sidebar width. */}
        {!compact &&
          (chipMode === "T" ? (
            <span data-no-cell-select="">
              <TimeChip time={step.time_of_day} color={color} small />
            </span>
          ) : (
            <input
              data-no-cell-select=""
              data-nav-col="effort"
              data-nav-row={step.id}
              type="text"
              inputMode="numeric"
              value={effortDraft}
              onChange={(e) =>
                setEffortDraft(e.target.value.replace(/[^0-9]/g, ""))
              }
              onBlur={commitEffort}
              onKeyDown={(e) => {
                const inp = e.target as HTMLInputElement;
                const atStart =
                  (inp.selectionStart ?? 0) === 0 &&
                  (inp.selectionEnd ?? 0) === 0;
                if (
                  e.key === "Enter" ||
                  e.key === "ArrowDown" ||
                  (e.key === "Tab" && !e.shiftKey)
                ) {
                  e.preventDefault();
                  commitEffort();
                  navigateInputs("effort", step.id, 1);
                } else if (
                  e.key === "ArrowUp" ||
                  (e.key === "Tab" && e.shiftKey)
                ) {
                  e.preventDefault();
                  commitEffort();
                  navigateInputs("effort", step.id, -1);
                } else if (e.key === "ArrowLeft" && atStart) {
                  e.preventDefault();
                  commitEffort();
                  focusSiblingCol(step.id, "label");
                } else if (e.key === "Escape") {
                  inp.blur();
                }
              }}
              placeholder="—"
              title="Estimated minutes"
              className="w-12 shrink-0 rounded bg-transparent px-1 py-0.5 text-right text-[9.9px] tabular-nums text-text-muted placeholder:text-text-dim focus:bg-surface focus:outline-none"
            />
          ))}
      </div>

      {/* Cell area */}
      <div className="relative flex-1">
        {inRange && (
          <>
            <button
              data-done-toggle=""
              onClick={onToggleDone}
              aria-label={isDone ? "Mark not done" : "Mark done"}
              title={isDone ? "Mark not done" : "Mark done"}
              className={cn(
                "absolute top-1/2 z-10 -translate-y-1/2 transition",
                isDone ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              style={{ left: cellLeft + cellWidth + 4 }}
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full border"
                style={{
                  borderColor: isDone ? color : "var(--border-strong)",
                  background: isDone ? color : "var(--bg-elev)",
                }}
              >
                {isDone && (
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                  >
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </span>
            </button>

            <button
              ref={cellRef}
              data-cell-step-id={step.id}
              data-cell-item-id={item.id}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                onCellPointerDown(item.id, step.id, e);
              }}
              onClick={(e) => e.preventDefault()}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setTimeOpen(true);
              }}
              className={cn(
                // Matches the item bar's title size (10.8px) — the step cell
                // text is primary content so it sits above the swept 9.9px,
                // but never larger than its parent bar's title.
                "task-bar absolute top-1/2 flex -translate-y-1/2 items-center justify-center text-center text-[10.8px] font-semibold tabular-nums",
                isDone && "line-through",
              )}
              style={{
                left: cellLeft,
                width: cellWidth,
                height: Math.max(14, rowH - 8),
                // Square off the right corners when the "D" semicircle attaches.
                borderRadius: deadlineOnThisStep ? "6px 0 0 6px" : "6px",
                // Fill rule: done → dim done tint; timed → low-opacity color
                // tint with FULL-colour time text; untimed (TBD) → color tint
                // with color-forward text. No borders on any state.
                background: isDone
                  ? `color-mix(in srgb, ${color} 10%, var(--bg-elev))`
                  : step.time_of_day
                    ? `color-mix(in srgb, ${color} 15%, var(--bg-elev))`
                    : `color-mix(in srgb, ${color} 12%, var(--bg-elev))`,
                color: isDone
                  ? "color-mix(in srgb, var(--text) 45%, transparent)"
                  : step.time_of_day
                    ? color
                    : `color-mix(in srgb, ${color} 58%, ${isDark ? "white" : "black"})`,
                transition:
                  "background-color 0.5s ease, color 0.5s ease, filter 0.12s ease",
                ...(isSelected && selectionSource === "timeline"
                  ? {
                      outline: "2px solid var(--accent)",
                      outlineOffset: 1,
                    }
                  : null),
              }}
            >
              <span className="block truncate px-1">
                {step.time_of_day ? fmtTime12(step.time_of_day) : step.label || "—"}
              </span>
            </button>

            {/* Semicircle "D" badge — same height as TBD, flush against its
                right edge, rounded on the right only. */}
            {deadlineOnThisStep && (
              <div
                data-cell-deadline-item-id={item.id}
                onPointerDown={onDeadlinePointerDown}
                onPointerMove={onDeadlinePointerMove}
                onPointerUp={onDeadlinePointerUp}
                onPointerCancel={onDeadlinePointerUp}
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 flex items-center justify-center text-[8.1px] font-bold transition hover:[filter:saturate(1.7)]",
                  "cursor-grab active:cursor-grabbing",
                  isDeadlineSelected &&
                    "ring-2 ring-accent ring-offset-1 ring-offset-bg",
                )}
                style={{
                  left: cellLeft + cellWidth - 1 + deadlineDragDelta * colW,
                  width: Math.round(Math.max(14, rowH - 8) * 0.75),
                  height: Math.max(14, rowH - 8),
                  borderRadius: "0 9999px 9999px 0",
                  background: "rgba(239, 68, 68, 0.12)",
                  color: "#ef4444",
                  zIndex: 10,
                }}
                title={`${item.title} deadline`}
              >
                D
              </div>
            )}

            {timeOpen && (
              // The SAME editor the calendar opens on its cards — one step
              // editor, one anatomy (label headline, icon-led time/effort
              // rows, add-another, done/delete footer). Replaces the old
              // bare time-grid TimePopover for step editing.
              <EventEditPopover
                anchorRef={cellRef}
                itemTitle={item.title}
                stepLabel={step.label}
                blockColor={color}
                time={step.time_of_day}
                durationMin={step.duration_min}
                isDone={isDone}
                onTimeChange={(t) => onUpdate({ time_of_day: t })}
                onDurationChange={(m) => onUpdate({ duration_min: m })}
                onLabelChange={(l) => onUpdate({ label: l })}
                onAddAnother={(t) => onRepeatStep(step, t)}
                onToggleDone={onToggleDone}
                onDelete={() => {
                  setTimeOpen(false);
                  onDelete();
                }}
                onClose={() => setTimeOpen(false)}
              />
            )}
          </>
        )}

        {/* Per-row Deadline cell — column derived from effectiveDeadlineOffset.
            When deadline lands on the same day as this step, the "D" pill
            above handles it, so skip rendering a duplicate here. */}
        {!deadlineOnThisStep && deadlineInRange ? (
          <div
            data-cell-deadline-item-id={item.id}
            onPointerDown={onDeadlinePointerDown}
            onPointerMove={onDeadlinePointerMove}
            onPointerUp={onDeadlinePointerUp}
            onPointerCancel={onDeadlinePointerUp}
            className={cn(
              "absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md text-center text-[9px] font-bold uppercase tracking-wider transition hover:[filter:saturate(1.7)]",
              "cursor-grab active:cursor-grabbing",
              isDeadlineSelected &&
                "ring-2 ring-accent ring-offset-1 ring-offset-bg",
            )}
            style={{
              left: deadlineLeft + deadlineDragDelta * colW,
              width: deadlineWidth,
              height: Math.max(14, rowH - 8),
              background: "rgba(239, 68, 68, 0.12)",
              color: "#ef4444",
            }}
            title={`${item.title} deadline`}
          >
            Deadline
          </div>
        ) : null}
      </div>

      {/* Universal row-height drag handle */}
      <div
        onPointerDown={(e) => heightDrag.start(e, rowH)}
        onPointerMove={heightDrag.move}
        onPointerUp={heightDrag.end}
        onPointerCancel={heightDrag.end}
        className="absolute bottom-0 left-0 z-30 h-1 cursor-ns-resize opacity-0 transition group-hover:opacity-100 hover:bg-accent/40"
        data-gantt-sidebar=""
        style={{ width: "var(--sidebar-w)", overflow: "hidden" }}
        title="Drag to resize ALL rows"
      />
    </div>
  );
});
