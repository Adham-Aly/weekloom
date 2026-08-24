import type * as React from "react";

/**
 * Shared layout constants for the Gantt board. Centralised so that
 * step-row.tsx, item-section.tsx, board.tsx, etc. agree on the same numbers
 * without each file declaring its own copy.
 */
/**
 * Default sidebar width. The runtime width is owned by board.tsx state
 * (drag-resizable, collapsible) and flowed through a `--sidebar-w` CSS
 * variable on the Gantt root, so every consumer that references the
 * sidebar uses `var(--sidebar-w)` for styling — no prop drilling.
 *
 * This constant is kept as the seed value + fallback when settings haven't
 * loaded yet.
 */
export const SIDEBAR_W = 360;
export const MIN_SIDEBAR_W = 220;
export const MAX_SIDEBAR_W = 600;
/** Width when collapsed — just enough room for the expand chevron. */
export const COLLAPSED_SIDEBAR_W = 28;
export const MIN_COL_W = 36;
export const MAX_COL_W = 240;
// Aligned to the calendar's 36px header rhythm (calendar.tsx HEADER_H = 36).
export const BLOCK_HEADER_H = 36;
export const ITEM_HEADER_H = 36;
export const MIN_ROW_H = 18;
export const MAX_ROW_H = 80;
export const DEADLINE_ROW_H = 30;
export const COUNTDOWN_ROW_H = 22;
export const DAY_ROW_H = 24;
// The merged day header (weekday + number on one row, à la the calendar).
// Was a stacked 24 + 30; now a single 36px row on the calendar's rhythm.
export const DATE_ROW_H = 36;
export const PILL_ROW_H = 22;

export type ViewMode = "gantt" | "week" | "day";
export type ChipMode = "T" | "E"; // Time or Effort

/**
 * The fields a cell pointer-down handler actually reads off the event.
 * Cell-selection is driven entirely by the mouse button + modifier keys,
 * so handlers take this minimal shape rather than a full
 * `React.PointerEvent`. A real pointer event satisfies it, and so do the
 * synthetic events the sidebar's drag-select builds — no casting needed.
 */
export type CellPointerInit = Pick<
  React.PointerEvent,
  "button" | "shiftKey" | "metaKey" | "ctrlKey"
>;
