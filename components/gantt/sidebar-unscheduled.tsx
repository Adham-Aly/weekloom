"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown } from "@/components/icons";
import { cn, toISODate } from "@/lib/utils";
import { isoAtOffset, parseISODate } from "@/lib/gantt/layout";
import { useEscape } from "@/lib/hooks/use-escape";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { MiniMonth } from "@/components/gantt/mini-month";
import type { Block, Item, Step } from "@/lib/types/database";

type Card = { step: Step; item: Item; block: Block | undefined };

/** Arm a pointer-drag: after a few px of travel, hand off to the calendar's own
 *  drag (which renders the snapping ghost and handles the drop). A plain click
 *  never fires, so it can't accidentally schedule the task. */
function armDrag(
  e: React.PointerEvent,
  stepId: string,
  onBeginDrag: (stepId: string, e: React.PointerEvent) => void,
) {
  if (e.button !== 0 || e.pointerType === "touch") return;
  const sx = e.clientX;
  const sy = e.clientY;
  const start = e;
  const move = (ev: PointerEvent) => {
    if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) {
      cleanup();
      onBeginDrag(stepId, start);
    }
  };
  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", cleanup);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", cleanup);
}

/**
 * The "unscheduled" tray: every timeless (TBD) task for a chosen day, pulled out
 * of the old strip at the top of each week column and into the sidebar. A date
 * dropdown (defaulting to today) picks the day; the cards below are meant to be
 * dragged onto the grid to give them a real time.
 */
export function SidebarUnscheduled({
  steps,
  items,
  blocks,
  onBeginDrag,
  date,
  onDateChange,
}: {
  steps: Step[];
  items: Item[];
  blocks: Block[];
  /** Begin dragging an unscheduled step onto the calendar (calendar owns the ghost). */
  onBeginDrag: (stepId: string, e: React.PointerEvent) => void;
  /** The day whose unscheduled tasks are shown — driven by the calendar. */
  date: string;
  onDateChange: (iso: string) => void;
}) {
  const todayISO = toISODate(new Date());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useOutsideClick([pickerRef], () => setPickerOpen(false));
  // ⚠️ Only while the picker is open — see the note on `ViewMenu` in
  // board.tsx. This tray is mounted for the whole life of Week/Day view, and a
  // closed dismissable left on the shared Escape stack swallows the key for
  // the calendar's own "clear the selection" handler underneath it.
  useEscape(() => setPickerOpen(false), pickerOpen);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const blocksById = useMemo(
    () => new Map(blocks.map((b) => [b.id, b])),
    [blocks],
  );

  // Every untimed step, grouped by the day it falls on.
  const byDate = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const s of steps) {
      // Timeless steps only — done ones included, mirroring the column TBD strip
      // (they render struck-through below), so the tray matches what you see.
      if (s.time_of_day !== null) continue;
      const item = itemsById.get(s.item_id);
      if (!item) continue;
      const d = isoAtOffset(item.start_date, s.day_offset);
      const card: Card = { step: s, item, block: blocksById.get(item.block_id ?? "") };
      const arr = m.get(d);
      if (arr) arr.push(card);
      else m.set(d, [card]);
    }
    return m;
  }, [steps, itemsById, blocksById]);

  const cards = byDate.get(date) ?? [];

  return (
    <div className="flex shrink-0 flex-col px-2 pb-2">
      {/* Section heading — matches the mini-calendar's "Month YYYY" label. */}
      <div className="mb-1.5 px-1 text-[10.8px] font-medium text-text-muted">
        Unscheduled
      </div>

      {/* Date label — "Today" by default, follows the calendar as you work, and
          opens a picker to jump to any day. */}
      <div ref={pickerRef} className="relative w-fit">
        <button
          onClick={() => setPickerOpen((o) => !o)}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-surface"
        >
          <span className="text-[11.7px] text-text-muted">
            {labelFor(date, todayISO)}
          </span>
          <ChevronDown
            width={13}
            height={13}
            className={cn(
              "shrink-0 text-text-dim transition",
              pickerOpen && "rotate-180",
            )}
          />
        </button>
        {pickerOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-60 rounded-xl border border-border-strong bg-bg-elev py-1 shadow-2xl shadow-black/50">
            <MiniMonth
              focusedISO={date}
              onPickDate={(iso) => {
                onDateChange(iso);
                setPickerOpen(false);
              }}
            />
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="mt-2 flex flex-col gap-1.5">
        {cards.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-1.5 px-3 text-center">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-surface text-text-dim">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4l2.5 1.5" />
              </svg>
            </div>
            <p className="text-[10.8px] text-text-muted">Nothing unscheduled</p>
            <p className="text-[9.9px] text-text-dim">
              Timeless tasks for this day land here.
            </p>
          </div>
        ) : (
          cards.map(({ step, item, block }) => {
            const color = item.color ?? block?.color ?? "#5a5c66";
            const name = step.label.trim() || item.title;
            const done = step.status === "done";
            // Same idiom as recurring cards: a dark tint of the block colour for
            // the fill, and a light-toward-text version of it for the label
            // (var(--text) resolves near-white on dark, near-black on light — so
            // it reads as a "light version of the colour" either way). No side
            // accent here, per request.
            return (
              <div
                key={step.id}
                onPointerDown={(e) => armDrag(e, step.id, onBeginDrag)}
                className={cn(
                  "group flex cursor-grab select-none items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:brightness-125 active:cursor-grabbing",
                  done && "opacity-60",
                )}
                style={{
                  background: `color-mix(in srgb, ${color} 12%, var(--bg))`,
                }}
                title={name}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate text-[10.3px] font-medium leading-tight",
                      done && "line-through",
                    )}
                    style={{
                      color: `color-mix(in srgb, ${color} 58%, var(--text))`,
                    }}
                  >
                    {item.recurrence ? "↻ " : ""}
                    {name}
                  </div>
                  {block && (
                    <div className="truncate text-[8.1px] font-bold uppercase tracking-wider text-text-muted">
                      {block.name}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function labelFor(iso: string, todayISO: string): string {
  if (iso === todayISO) return "Today";
  const d = parseISODate(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
