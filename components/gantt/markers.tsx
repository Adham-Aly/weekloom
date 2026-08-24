"use client";

import { Flag } from "@/components/icons";
import { useMenu } from "@/components/ui/context-menu";
import type { Deadline, Item } from "@/lib/types/database";
import { cn, daysBetween, toISODate } from "@/lib/utils";
import { MAX_COL_W, MIN_COL_W } from "@/lib/gantt/constants";
import { deadlineTone } from "@/lib/gantt/deadline-tone";
import { useResizeDrag } from "@/lib/hooks/use-resize-drag";

/**
 * One day cell in the Gantt header — weekday label + day number side by side
 * on a single row, matching the calendar's day header. Today's number sits in
 * a solid accent chip (not a full-cell wash). No per-column border: the header
 * strip carries its own bottom hairline.
 *
 * When `onPick` is provided (the board is in day-focus mode), the body of
 * the cell becomes a clickable target that switches the focused day. The
 * resize handle on the right edge is unaffected.
 */
export function ColumnHeaderCell({
  weekday,
  dayDate,
  width,
  isToday: today,
  isWeekend,
  isFocused,
  onResize,
  onPick,
}: {
  weekday: string;
  dayDate: number;
  width: number;
  isToday: boolean;
  isWeekend?: boolean;
  isFocused?: boolean;
  onResize: (w: number) => void;
  onPick?: () => void;
}) {
  // Spreadsheet-style resize: a vertical guideline tracks the cursor
  // during drag and the new width commits to React state only on release.
  // No re-renders mid-drag → no visible lag on busy boards.
  const drag = useResizeDrag({
    axis: "x",
    min: MIN_COL_W,
    max: MAX_COL_W,
    onCommit: onResize,
  });
  return (
    <div
      className={cn(
        "relative flex flex-row items-center justify-center gap-1.5 transition",
        onPick && "cursor-pointer hover:bg-surface/40",
        isFocused && "bg-surface/40",
      )}
      style={{
        width,
        // Weekend columns get a very light gray header (theme-aware) instead
        // of a full-height body wash.
        ...(isWeekend && !isFocused
          ? { background: "color-mix(in srgb, var(--text) 4%, transparent)" }
          : null),
      }}
      onClick={onPick}
      title={onPick ? "Focus on this day" : undefined}
    >
      <span className="text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
        {weekday}
      </span>
      <span
        className={cn(
          "text-[9.5px] font-medium tabular-nums",
          today
            ? "rounded-md bg-accent px-1.5 py-0.5 text-white"
            : "text-text-muted",
        )}
      >
        {dayDate}
      </span>
      <div
        onPointerDown={(e) => drag.start(e, width)}
        onPointerMove={drag.move}
        onPointerUp={drag.end}
        onPointerCancel={drag.end}
        className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/40"
        title="Drag to resize all columns"
      />
    </div>
  );
}

/** A free-standing deadline pill placed by greedy-pack into the header. */
export function DeadlineMarker({
  deadline,
  left,
  top,
  onDelete,
}: {
  deadline: Deadline;
  left: number;
  top: number;
  onDelete: () => void;
}) {
  const dDays = daysBetween(toISODate(new Date()), deadline.date);
  const tone = deadlineTone(dDays);
  const label =
    dDays === 0 ? "today" : dDays < 0 ? `${Math.abs(dDays)}d late` : `${dDays}d`;
  const ctxProps = useMenu(() => [
    { label: "Delete deadline", destructive: true, onClick: onDelete },
  ]);
  return (
    <div {...ctxProps} className="absolute" style={{ left: left + 2, top }}>
      <div
        className="flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[10.3px] font-medium"
        style={{
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          color: tone.text,
        }}
      >
        <Flag width={10} height={10} />
        <span className="whitespace-nowrap">{deadline.name}</span>
        <span
          className="rounded px-1 py-px font-mono text-[9px] font-bold tabular-nums"
          style={{ background: tone.countBg, color: tone.countText }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

/**
 * Compact horizontal "deadline chip rail". One fixed-height row regardless
 * of how many
 * items are pinned; overflow scrolls horizontally. Each chip is
 * urgency-coloured (red overdue, amber ≤2 days, accent on today,
 * neutral otherwise), click to jump-to-item (via onJump), right-click
 * to unpin.
 */
const CHIP_RAIL_H = 28;

export function PinnedChipRail({
  pinnedItems,
  pinnedDeadlineDates,
  gridWidth,
  onUnpin,
  onJump,
}: {
  pinnedItems: Item[];
  pinnedDeadlineDates: Map<string, string>;
  gridWidth: number;
  onUnpin: (id: string) => void;
  onJump?: (item: Item) => void;
}) {
  if (pinnedItems.length === 0) return null;
  return (
    <div
      className="flex bg-bg-elev backdrop-blur"
      style={{
        height: CHIP_RAIL_H,
        borderBottom: "1px solid var(--border)",
        width: `calc(var(--sidebar-w) + ${gridWidth}px)`,
      }}
    >
      <div
        className="sticky left-0 z-50 flex h-full items-center border-r border-border bg-bg-elev px-3 backdrop-blur"
        data-gantt-sidebar=""
        style={{ width: "var(--sidebar-w)", overflow: "hidden" }}
      >
        <span className="text-[9px] font-medium uppercase tracking-wider text-text-dim">
          Tracking
        </span>
        <span className="ml-1.5 rounded bg-bg px-1.5 py-0.5 text-[9px] tabular-nums text-text-muted">
          {pinnedItems.length}
        </span>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div className="scrollbar-thin flex h-full items-center gap-1.5 overflow-x-auto px-3">
          {pinnedItems.map((item) => (
            <PinnedChip
              key={item.id}
              item={item}
              date={pinnedDeadlineDates.get(item.id) ?? ""}
              onUnpin={() => onUnpin(item.id)}
              onJump={onJump ? () => onJump(item) : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PinnedChip({
  item,
  date,
  onUnpin,
  onJump,
}: {
  item: Item;
  date: string;
  onUnpin: () => void;
  onJump?: () => void;
}) {
  const dDays = date ? daysBetween(toISODate(new Date()), date) : 0;
  const overdue = dDays < 0;
  const isToday = dDays === 0;
  const ctxProps = useMenu(() => [
    { label: "Unpin", destructive: true, onClick: onUnpin },
  ]);

  const tone = deadlineTone(dDays);

  const label = isToday
    ? "today"
    : overdue
      ? `${Math.abs(dDays)}d late`
      : `${dDays}d`;

  return (
    <div
      {...ctxProps}
      onClick={onJump}
      title={`${item.title}${date ? ` — due ${date}` : ""}\nRight-click to unpin`}
      className={cn(
        "group flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-[10.3px]",
        onJump && "cursor-pointer hover:brightness-110",
      )}
      style={{
        background: tone.bg,
        borderColor: tone.border,
        color: tone.text,
      }}
    >
      <span className="max-w-[140px] truncate font-medium">{item.title}</span>
      <span
        className="shrink-0 rounded px-1 py-px font-mono text-[9px] font-bold tabular-nums"
        style={{ background: tone.countBg, color: tone.countText }}
      >
        {label}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onUnpin();
        }}
        title="Unpin"
        aria-label="Unpin"
        className="-mr-0.5 ml-0.5 hidden h-3.5 w-3.5 items-center justify-center rounded text-text-dim transition hover:bg-black/20 hover:text-text group-hover:flex"
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6l-12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * A pinned-item marker in the Deadlines header strip. Intentionally tiny
 * — just a flag icon + countdown — so 5–6 of them pack onto a single
 * row even when their dates collide. The full item title lives in the
 * chip rail below; this marker's only job is "something pinned lands
 * on THIS column."
 */
export function PinnedItemMarker({
  item,
  date,
  left,
  top,
  onUnpin,
}: {
  item: Item;
  date: string;
  left: number;
  top: number;
  onUnpin: () => void;
}) {
  const dDays = daysBetween(toISODate(new Date()), date);
  const overdue = dDays < 0;
  const isToday = dDays === 0;
  const tone = deadlineTone(dDays);
  const ctxProps = useMenu(() => [
    { label: "Unpin from Deadlines", destructive: true, onClick: onUnpin },
  ]);
  const label = isToday ? "0" : overdue ? `+${Math.abs(dDays)}` : `${dDays}`;
  return (
    <div
      {...ctxProps}
      className="absolute"
      style={{ left: left + 2, top }}
      title={`${item.title}${date ? ` — ${date}` : ""}\nRight-click to unpin`}
    >
      <div
        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold tabular-nums"
        style={{
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          color: tone.countText,
        }}
      >
        <Flag width={9} height={9} />
        <span>{label}d</span>
      </div>
    </div>
  );
}
