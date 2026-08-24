"use client";

import { useEffect, useState } from "react";
import type { Block, Item, Step } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { computeItemBarRange, greedyPack } from "@/lib/gantt/layout";

const BAR_ROW_H = 14;

/**
 * When a block is collapsed, render its items' bars greedy-packed into a
 * compact summary strip — same collision-avoidance logic as the deadline
 * pills. Clicking a bar opens that item's edit modal.
 *
 * Each bar exposes `data-cell-item-bar` so the board-level marquee can
 * lasso multiple collapsed bars across blocks and arrow-shift them
 * together. `selectedItemIds` drives the selection ring.
 */
export function CollapsedBarsSummary({
  items,
  block,
  stepsByItem,
  days,
  colW,
  rangeStartISO,
  gridWidth,
  onEditItem,
  selectedItemIds,
  onSelectItem,
}: {
  items: Item[];
  block: Block;
  stepsByItem: Map<string, Step[]>;
  days: Date[];
  colW: number;
  rangeStartISO: string;
  gridWidth: number;
  onEditItem: (i: Item) => void;
  selectedItemIds?: ReadonlySet<string>;
  onSelectItem?: (
    itemId: string,
    mode: "replace" | "extend" | "toggle",
  ) => void;
}) {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.dataset.theme !== "light"
      : true,
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.dataset.theme !== "light"),
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);

  const bars = items.map((it) => {
    const itSteps = stepsByItem.get(it.id) ?? [];
    const range = computeItemBarRange(it, itSteps, rangeStartISO, days.length);
    return {
      id: it.id,
      item: it,
      left: range.visibleStartIdx * colW,
      width: (range.visibleEndIdx - range.visibleStartIdx + 1) * colW,
      inRange: range.inRange,
    };
  });

  const visibleBars = bars.filter((b) => b.inRange);
  const { rowByKey: barRow, rowEnds } = greedyPack(
    visibleBars.map((b) => ({ key: b.id, left: b.left, width: b.width })),
    2,
  );
  const rowCount = Math.max(1, rowEnds.length);
  const totalH = rowCount * BAR_ROW_H + 6;

  return (
    <div
      className="flex border-b border-border/40"
      style={{
        height: totalH,
        width: `calc(var(--sidebar-w) + ${gridWidth}px)`,
      }}
    >
      <div
        className="sticky left-0 z-50 bg-bg"
        data-gantt-sidebar=""
        style={{
          width: "var(--sidebar-w)",
          overflow: "hidden",
          borderRight: "1px solid var(--border)",
        }}
      />
      <div className="relative flex-1">
        {bars.map((b) => {
          if (!b.inRange) return null;
          const color = b.item.color ?? block.color;
          const selected = selectedItemIds?.has(b.id) ?? false;
          return (
            <button
              key={b.id}
              data-cell-item-bar={b.id}
              data-cell-item-id={b.id}
              onClick={(e) => {
                // Modifier-click: add/remove/extend the items selection.
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  e.stopPropagation();
                  e.preventDefault();
                  const mode = e.shiftKey
                    ? "extend"
                    : e.metaKey || e.ctrlKey
                      ? "toggle"
                      : "replace";
                  onSelectItem?.(b.id, mode);
                  return;
                }
                // Plain click on a selected bar: swallow (would re-open
                // editor right after marquee drop, which is annoying).
                if (selected) return;
                onEditItem(b.item);
                e.stopPropagation();
              }}
              title={b.item.title}
              className={cn(
                "absolute overflow-hidden rounded-sm text-left text-[9px] font-medium transition hover:[filter:saturate(1.7)]",
                selected && "ring-2 ring-accent ring-offset-1 ring-offset-bg",
              )}
              style={{
                left: b.left + 1,
                width: Math.max(b.width - 2, 4),
                top: (barRow.get(b.id) ?? 0) * BAR_ROW_H + 3,
                height: BAR_ROW_H - 2,
                backgroundColor: `${color}55`,
                color: isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.75)",
                paddingLeft: 4,
                paddingRight: 4,
              }}
            >
              <span className="block truncate leading-[9px]">
                {b.item.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
