"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight } from "@/components/icons";
import { useMenu } from "@/components/ui/context-menu";
import { TimeChip } from "@/components/ui/time-picker";
import type { Block, Item, Step } from "@/lib/types/database";
import { fmtFull } from "@/lib/utils";
import { BLOCK_HEADER_H } from "@/lib/gantt/constants";

export type CompletedEntryData = {
  step: Step;
  item: Item;
  block: Block | undefined;
};

/**
 * The "Completed" system block. Renders as a flat, non-grid list of **done
 * steps** — one entry per finished step, gathered from every block.
 *
 * It does NOT contain moved items. An earlier comment here claimed a completed
 * step's parent item was relocated into this block by `reconcileItemCompletion`;
 * that function was dead code and has been deleted. What actually happens is
 * simpler and entirely client-side: `onToggleStepDone` writes `{status,
 * completed_at}` on the step and nothing else, and the board hides an item from
 * its own lane once every one of its steps is done. Nothing is reparented.
 */
export function CompletedSection({
  block,
  entries,
  onToggleBlock,
  onToggleStepDone,
  onDeleteStep,
  gridWidth,
}: {
  block: Block;
  entries: CompletedEntryData[];
  onToggleBlock: () => void;
  onToggleStepDone: (s: Step) => void;
  onDeleteStep: (s: Step) => void;
  gridWidth: number;
}) {
  return (
    <section>
      <div
        className="flex items-stretch border-b border-border bg-bg-elev"
        style={{
          height: BLOCK_HEADER_H,
          width: `calc(var(--sidebar-w) + ${gridWidth}px)`,
        }}
      >
        <button
          onClick={onToggleBlock}
          className="sticky left-0 z-50 flex h-full items-center gap-2 bg-bg-elev px-4 text-left"
          data-gantt-sidebar=""
          style={{
            width: "var(--sidebar-w)",
            overflow: "hidden",
            borderRight: "1px solid var(--border)",
          }}
        >
          <span className="text-text-muted">
            {block.collapsed ? (
              <ChevronRight width={12} height={12} />
            ) : (
              <ChevronDown width={12} height={12} />
            )}
          </span>
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: block.color }}
          />
          <span className="text-[10.8px] font-semibold uppercase tracking-wider text-text">
            {block.name}
          </span>
          <span className="text-[9px] text-text-dim tabular-nums">
            {entries.length}
          </span>
          <span className="ml-auto text-[9px] text-text-dim">system</span>
        </button>
        <div className="flex-1" />
      </div>

      {!block.collapsed && (
        <AnimatePresence initial={false}>
          {entries.length === 0 ? (
            <div
              // ⚠️ `bg-bg` is not decoration. This is a `sticky left-0` cell
              // sitting over the scrolling day grid, so WITHOUT a background
              // the day gridlines are drawn straight through the sidebar
              // column and the sidebar's edge appears to stop mid-canvas.
              // `CompletedEntry` — the sibling that renders in this exact slot
              // when there ARE entries — carries the same fill for the same
              // reason, which is why the seam only showed on an empty lane.
              className="sticky left-0 bg-bg px-8 py-4 text-[10.8px] italic text-text-dim"
              data-gantt-sidebar=""
              style={{ width: "var(--sidebar-w)", overflow: "hidden" }}
            >
              Mark a step done and it&apos;ll land here.
            </div>
          ) : (
            entries.map((e) => (
              <motion.div
                key={e.step.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.18 }}
              >
                <CompletedEntry
                  entry={e}
                  onUnmark={() => onToggleStepDone(e.step)}
                  onDelete={() => onDeleteStep(e.step)}
                />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      )}
      <div style={{ height: 4 }} />
    </section>
  );
}

function CompletedEntry({
  entry,
  onUnmark,
  onDelete,
}: {
  entry: CompletedEntryData;
  onUnmark: () => void;
  onDelete: () => void;
}) {
  const color = entry.item.color ?? entry.block?.color ?? "#10b981";
  const completedDate = entry.step.completed_at
    ? fmtFull(new Date(entry.step.completed_at))
    : "";
  const menu = useMenu(() => [
    { label: "Mark not done (restore)", onClick: onUnmark },
    { type: "separator" as const },
    { label: "Delete forever", destructive: true, onClick: onDelete },
  ]);

  return (
    <div
      {...menu}
      className="sticky left-0 flex items-center gap-2 bg-bg pl-8 pr-4 py-1.5 text-[11.2px]"
      data-gantt-sidebar=""
      style={{
        width: "var(--sidebar-w)",
        overflow: "hidden",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <button
        onClick={onUnmark}
        title="Mark not done"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: color, background: color }}
      >
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
      </button>
      <span
        className="h-2 w-0.5 shrink-0 rounded-sm"
        style={{ background: color }}
      />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate font-medium text-text-muted">
          {entry.item.title}
        </span>
        <span className="text-text-dim">·</span>
        <span className="truncate text-text">
          {entry.step.label || "(no label)"}
        </span>
      </div>
      <TimeChip time={entry.step.time_of_day} small />
      <span className="shrink-0 text-[9px] tabular-nums text-text-dim">
        {completedDate}
      </span>
    </div>
  );
}
