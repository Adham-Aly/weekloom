"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  addDays,
  buildDateRange,
  cn,
  daysBetween,
  effectiveDeadlineOffset,
  fmtDay,
  fmtFull,
  isToday,
  startOfWeekSun,
  toISODate,
} from "@/lib/utils";
import type {
  Block,
  Board,
  Deadline,
  Item,
  Recurrence,
  Step,
} from "@/lib/types/database";
import {
  MATERIALIZE_AHEAD_DAYS,
  occurrenceOffsets,
} from "@/lib/calendar/recurrence";
import {
  createBlock,
  addStepAt,
  createDeadline,
  createItemWithSteps,
  deleteBlock,
  deleteDeadline,
  deleteItem,
  deleteStep,
  applyItemMove,
  materializeBoardSeries,
  resizeItem,
  setActiveBoard,
  swapSteps,
  updateBlock,
  updateBoard,
  updateItem,
  updateSettings,
  updateStep,
} from "@/app/actions";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Flag,
  Pin,
  Plus,
} from "@/components/icons";
import { ListTodo, PanelLeft, ToyBrick } from "lucide-react";
import Link from "next/link";
import type { ResolvedSettings } from "@/lib/types/settings";
import { shouldMaterialize } from "@/lib/calendar/materialize-trigger";
import { sfx } from "@/lib/sound";
import { BlockModal } from "@/components/modals/block-modal";
import { BlockIcon } from "@/components/modals/block-icon-picker";
import { SearchModal } from "@/components/modals/search-modal";
import { Personalization } from "@/components/personalization";
import { ItemModal } from "@/components/modals/item-modal";
import { DeadlineModal } from "@/components/modals/deadline-modal";
import { PinDeadlinesModal } from "@/components/modals/pin-deadlines-modal";
import { DateJumpModal } from "@/components/modals/date-jump-modal";
import { CalendarView } from "@/components/gantt/calendar";
import { MiniMonthLive } from "@/components/gantt/mini-month";
import { SidebarUnscheduled } from "@/components/gantt/sidebar-unscheduled";
import {
  BoardEditContext,
  useBoardEdit,
  type BoardEditCtx,
} from "@/lib/hooks/board-edit-context";
import { useDialogs } from "@/components/ui/dialogs";
import { useMenu } from "@/components/ui/context-menu";
import { useEscape } from "@/lib/hooks/use-escape";
import { useFlushOnUnload } from "@/lib/hooks/use-flush-on-unload";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import { TimeChip, TimePopover } from "@/components/ui/time-picker";
import {
  computeItemBarRange,
  estimatePillWidth,
  greedyPack,
  isoAtOffset,
  parseISODate,
} from "@/lib/gantt/layout";
import { useMarquee } from "@/lib/hooks/use-marquee";
import { useResizeDrag } from "@/lib/hooks/use-resize-drag";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useViewport } from "@/lib/hooks/use-viewport";
import { useUndo } from "@/lib/undo/use-undo";
import { useIsDarkTheme } from "@/lib/hooks/use-is-dark-theme";
import { computeShift } from "@/lib/gantt/shift";
import {
  computeBodyDrag,
  computeLeftPull,
  type LeftPullResult,
} from "@/lib/gantt/body-drag";

import {
  BLOCK_HEADER_H,
  COUNTDOWN_ROW_H,
  DATE_ROW_H,
  ITEM_HEADER_H,
  MAX_COL_W,
  MIN_COL_W,
  MIN_ROW_H,
  COLLAPSED_SIDEBAR_W,
  MAX_SIDEBAR_W,
  MIN_SIDEBAR_W,
  type CellPointerInit,
  type ChipMode,
  type ViewMode,
} from "@/lib/gantt/constants";
import { focusSiblingCol, navigateInputs } from "@/lib/gantt/dom-nav";
import { StepRow } from "@/components/gantt/step-row";
import { BoardName } from "@/components/gantt/board-name";
import { LogoMark } from "@/components/ui/logo-mark";
import { MobileBottomNav } from "@/components/gantt/mobile-bottom-nav";
import { CompletedSection } from "@/components/gantt/completed-section";
import {
  ColumnHeaderCell,
  DeadlineMarker,
  PinnedChipRail,
  PinnedItemMarker,
} from "@/components/gantt/markers";
import { CollapsedBarsSummary } from "@/components/gantt/collapsed-bars-summary";
import { PRODUCT_NAME } from "@/lib/brand";

// Module-level variants so framer-motion doesn't see a new object every render
// Cascade ramps in quickly. Previously stagger=0.4×duration=0.45 made a 5-step
// item take ~2.5s to finish — the user couldn't interact mid-cascade.
const stepContainerVariants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
} as const;
const stepRowVariants = {
  hidden: { opacity: 0, x: -24, scale: 0.94 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      duration: 0.22,
      ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number],
    },
  },
} as const;

export function GanttBoard({
  initialBlocks,
  initialItems,
  initialSteps,
  initialDeadlines,
  settings,
  activeBoardId,
  activeBoard,
  banner,
  initialView = "gantt",
  initialDayViewDate = null,
}: {
  initialBlocks: Block[];
  initialItems: Item[];
  initialSteps: Step[];
  initialDeadlines: Deadline[];
  settings: ResolvedSettings;
  /**
   * All of the user's active boards, sorted by the page. Only the ACTIVE
   * board's blocks/items/steps/deadlines are loaded into the surrounding
   * state — boards are switched by real navigation to /app/<id>/gantt, not
   * in-app (the home screen at /app owns the full grid). Accepted here for the
   * board-aware contract and deliberately NOT destructured: nothing in this
   * component renders the list.
   */
  initialBoards: Board[];
  /**
   * The active board's id. Stamped onto every optimistic create (blocks,
   * items, steps, deadlines) and threaded through the matching server actions,
   * which require it. Also embedded in the URL the replaceState effect builds:
   * /app/<activeBoardId>/<view>.
   */
  activeBoardId: string;
  /**
   * The active board row. Its `name` renders (editable inline) in the
   * top-right of the TopBar where the user email used to sit; renames persist
   * via `updateBoard`. Empty names display as "Untitled Board".
   */
  activeBoard: Board;
  /** Optional sticky banner rendered above the TopBar. */
  banner?: React.ReactNode;
  /** Which view to open on first render. Defaults to "gantt". */
  initialView?: ViewMode;
  /** Date string for day view when opened via /app/day/YYYY-MM-DD. */
  initialDayViewDate?: string | null;
}) {
  const PAST_DAYS_DEFAULT = settings.pastDays;
  const PAST_DAYS_EXPANDED = settings.pastDaysExpanded;
  const FUTURE_DAYS = settings.futureDays;

  const [blocks, setBlocks] = useState(initialBlocks);
  const [items, setItems] = useState(initialItems);
  const [steps, setSteps] = useState(initialSteps);
  const [deadlines, setDeadlines] = useState(initialDeadlines);
  // The active board's name, editable inline in the TopBar. Held locally so a
  // rename reflects instantly (optimistic) before the `updateBoard` round-trip
  // lands. Initialized from the server-provided board row.
  const [boardName, setBoardName] = useState(activeBoard.name);

  // The Notion-style calendar sidebar's collapse state (local to this session).
  const [calSidebarCollapsed, setCalSidebarCollapsed] = useState(false);
  // Which day the Unscheduled tray shows. Defaults to today, follows the day
  // you click/drop into on the grid, and the tray's own picker can override it.
  const [unscheduledDate, setUnscheduledDate] = useState(() =>
    toISODate(new Date()),
  );
  // Stable proxy to the latest applyShiftToItem (a hoisted function defined
  // below) so the deadline drag-to-move can commit through the edit context
  // without re-creating the context value every render.
  const applyShiftRef = useRef(applyShiftToItem);
  useEffect(() => {
    applyShiftRef.current = applyShiftToItem;
  });
  // Drag-move an item's deadline by N days. Reuses the exact arrow-key shift
  // logic (deadline-only mask), so the same floor/clamp rules apply.
  const moveDeadline = useCallback((itemId: string, deltaDays: number) => {
    if (deltaDays === 0) return;
    recordSnapshot();
    applyShiftRef.current(itemId, new Set<string>(), true, deltaDays);
  }, []);

  // Cross-cutting edit state for the grid (the deadline drag), provided via
  // context so ItemSection / StepRow / DraftCreateRow can consume it without
  // threading through the huge prop bags.
  const editCtxValue = useMemo<BoardEditCtx>(
    () => ({ moveDeadline }),
    [moveDeadline],
  );

  // Browser notifications — fires while the page is open. There is no service
  // worker and no push server: the app is local, so a notification only makes
  // sense while its window is up.
  useNotifications(items, steps, settings);

  // ─── Undo / redo (last N board mutations) ──────────────────────────
  // Snapshot-based: every mutation entry point calls recordSnapshot()
  // first; Cmd+Z restores the previous client state and diff-syncs to
  // the server. The depth is the hook's own DEFAULT_MAX_STACK — a memory
  // bound (each entry is a deep-copied whole-board snapshot), never a
  // per-user setting, which is why no caller passes one.
  const undoApi = useUndo({
    getState: () => ({
      blocks,
      items,
      steps,
      deadlines,
      pinnedItemIds,
    }),
    applyState: (s) => {
      setBlocks(s.blocks);
      setItems(s.items);
      setSteps(s.steps);
      setDeadlines(s.deadlines);
      setPinnedItemIds(s.pinnedItemIds);
    },
    onError: (msg) => console.error("[undo]", msg),
  });
  const recordSnapshot = undoApi.recordSnapshot;
  const [view, setView] = useState<ViewMode>(initialView);
  const [dayViewDate, setDayViewDate] = useState<string | null>(initialDayViewDate);

  /**
   * Switch into the week (calendar) view. Used by every "go to Week/Day" entry
   * point — the view-pill, the "2" / G-W shortcuts, and the day↔week toggles.
   * Day view is a sub-mode reached through the calendar, so `requestDayView`
   * is the thin companion the day pill uses.
   */
  function requestWeekView() {
    setView("week");
  }
  function requestDayView(iso: string) {
    setDayViewDate(iso);
    setView("day");
  }

  // Keep the URL in sync with the active view so the address bar reflects
  // where the user is. replaceState avoids polluting browser history —
  // view-switching isn't a real navigation.
  useEffect(() => {
    // Board-scoped routing: every view path carries the active board id as its
    // leading segment — /app/<boardId>/gantt | week | day/<date>.
    const base = `/app/${activeBoardId}`;
    const path =
      view === "gantt"
        ? `${base}/gantt`
        : view === "week"
          ? `${base}/week`
          : `${base}/day/${dayViewDate ?? toISODate(new Date())}`;
    // Guard prevents Next.js from intercepting replaceState as a navigation
    // and re-rendering the server component in a loop.
    if (window.location.pathname === path) return;
    window.history.replaceState(null, "", path);
  }, [view, dayViewDate, activeBoardId]);
  // Persist the board the user is actually looking at so the home screen's
  // "Current" badge and bare-/app redirect track the last-opened board. This
  // is the only place active-board is written — opening a board IS the signal.
  useEffect(() => {
    void setActiveBoard(activeBoardId);
  }, [activeBoardId]);
  // Week view's visible week, anchored to its Sunday. Session-only; "Today"
  // resets it to the current week.
  const [weekStartISO, setWeekStartISO] = useState<string>(() =>
    toISODate(startOfWeekSun(new Date())),
  );
  const goPrevWeek = useCallback(
    () => setWeekStartISO((iso) => toISODate(addDays(parseISODate(iso), -7))),
    [],
  );
  const goNextWeek = useCallback(
    () => setWeekStartISO((iso) => toISODate(addDays(parseISODate(iso), 7))),
    [],
  );
  const goThisWeek = useCallback(
    () => setWeekStartISO(toISODate(startOfWeekSun(new Date()))),
    [],
  );
  const isCurrentWeek = weekStartISO === toISODate(startOfWeekSun(new Date()));

  // LIVE pan preview channel: the calendar reports whole-day viewport offsets
  // while mid-pan; they flow through this REF straight into MiniMonthLive so
  // ONLY the mini-month re-renders — board state here would re-render the whole
  // tree on every day-crossing, which is visible jitter mid-gesture.
  const livePanCbRef = useRef<((days: number) => void) | null>(null);
  const onCalLivePan = useCallback((days: number) => {
    livePanCbRef.current?.(days);
  }, []);
  const registerLivePan = useCallback(
    (cb: ((days: number) => void) | null) => {
      livePanCbRef.current = cb;
    },
    [],
  );

  // The date the calendar is centred on, for the sidebar mini-month highlight.
  const calFocusedISO =
    view === "day" ? (dayViewDate ?? toISODate(new Date())) : weekStartISO;
  // Picking a day in the mini-month jumps the main calendar there: the day
  // itself in day view, or its week in week view.
  const goToDate = useCallback(
    (iso: string) => {
      if (view === "day") setDayViewDate(iso);
      else setWeekStartISO(toISODate(startOfWeekSun(parseISODate(iso))));
    },
    [view],
  );

  // Dragging an unscheduled step from the sidebar onto the grid: the calendar
  // owns the drag (its snapping ghost + drop), and registers its starter here.
  // The sidebar's pointer-drag calls onCardBeginDrag, which hands the calendar
  // the step's own occurrence day to anchor the drag on.
  const beginDragRef = useRef<
    ((stepId: string, occurrenceDate: string, durationMin: number) => void) | null
  >(null);
  const registerBeginDrag = useCallback(
    (fn: (stepId: string, occurrenceDate: string, durationMin: number) => void) => {
      beginDragRef.current = fn;
    },
    [],
  );
  const onCardBeginDrag = useCallback(
    (stepId: string) => {
      const step = steps.find((s) => s.id === stepId);
      if (!step) return;
      const item = items.find((i) => i.id === step.item_id);
      if (!item) return;
      const occurrenceDate = toISODate(
        addDays(parseISODate(item.start_date), step.day_offset),
      );
      beginDragRef.current?.(stepId, occurrenceDate, step.duration_min ?? 30);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, items],
  );
  const [showPast, setShowPast] = useState(false);
  // Column width + row height live in DB-backed settings (per-device-roaming).
  const [colW, setColW] = useState<number>(settings.colW);
  const [rowH, setRowH] = useState<number>(settings.rowH);
  // Sidebar width is DB-persisted (drag adjusts a user preference). Collapsed
  // state is *session-only* so a bad render or stuck CSS can never leave the
  // user trapped in a state where they can't see the expand control — a
  // simple refresh always restores the expanded view.
  const [sidebarW, setSidebarW] = useState<number>(settings.sidebarW);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  // Which block's header occupies the pinned slot in the date-header band.
  // Tracks the section currently under the sticky header while scrolling
  // (iOS-style section headers) — NOT just the literal first block. Null →
  // fall back to the first active block.
  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null);
  // The block whose section is approaching from below mid-push — rendered as
  // the incoming layer that shoves the current header up (iOS section-header
  // push). Null outside the push window.
  const [upcomingBlockId, setUpcomingBlockId] = useState<string | null>(null);
  // Kept in a ref so the every-render re-measure effect below can call the
  // latest closure without re-attaching the scroll listener.
  const measurePinnedBlockRef = useRef<() => void>(() => {});
  // Theme is also DB-backed but mirrored to localStorage for no-flash boot.
  const [theme, setTheme] = useState<"dark" | "light">(settings.theme);
  // Per-item collapse. Seeded from the settings document rather than hydrated
  // in an effect: `settings` arrives as a prop from the server, so the first
  // client render matches the server's and a collapsed item never flashes open
  // on the way in. `Array.isArray` because the column is JSON a person could
  // have hand-edited — the same tolerance the old `JSON.parse` try/catch had.
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(() =>
    Array.isArray(settings.collapsedItemIds)
      ? new Set(settings.collapsedItemIds)
      : new Set(),
  );
  // Items pinned to the Deadlines strip — stored in the settings document,
  // so the strip is the same on the next launch.
  const [pinnedItemIds, setPinnedItemIds] = useState<string[]>(
    settings.pinnedItemIds ?? [],
  );
  const [chipModeByBlock, setChipModeByBlock] = useState<
    Record<string, ChipMode>
  >(() => settings.chipModeByBlock ?? {});
  // The lane the last task was created in — the New-task modal pre-selects it.
  const [lastBlockId, setLastBlockId] = useState<string | null>(
    settings.lastBlockId ?? null,
  );
  const [freshlyCreatedId, setFreshlyCreatedId] = useState<string | null>(null);

  // ─── Day-focus mode ───────────────────────────────────────────────
  // When set, the Gantt body shows only items that have a step on this
  // exact date. Blocks/items render as if expanded regardless of their
  // persisted collapse state (the collapse state is preserved — we just
  // override it for display while focused).
  const [focusedDayISO, setFocusedDayISO] = useState<string | null>(null);
  const isFocused = focusedDayISO !== null;

  // Mobile: the Gantt timeline grid doesn't fit on a phone. Auto-enable
  // day-focus on the first phone render so the user gets the today-only
  // collapsed view instead of an unreadable timeline. Done once on mount
  // — if the user manually exits focus later we respect that choice.
  const viewport = useViewport();
  const didAutoFocusForMobileRef = useRef(false);
  useEffect(() => {
    if (
      viewport.isMobile &&
      !focusedDayISO &&
      !didAutoFocusForMobileRef.current
    ) {
      didAutoFocusForMobileRef.current = true;
      setFocusedDayISO(toISODate(new Date()));
    }
  }, [viewport.isMobile, focusedDayISO]);

  /**
   * Sidebar width applied to `--sidebar-w`. Three overrides on top of
   * the user's persisted preference:
   *   - sidebarCollapsed → tiny strip with just the expand chevron
   *   - mobile           → cap at 140px so the day-focused column fits
   *                        on a phone (a 360px sidebar leaves ~15px on
   *                        a 375px iPhone)
   *   - focus mode       → drop to ~180px regardless of device; in
   *                        focus mode the sidebar shows item titles
   *                        only (no chips/counts), so it doesn't need
   *                        the full preference width.
   */
  // On mobile, size the sidebar so ~1.6 day columns peek in from the
  // right: a full column for today plus a half-column for tomorrow as a
  // visual hint that horizontal scroll is possible. Floor at 130px so
  // item titles don't compress into uselessness on phones with wider
  // column preferences.
  //
  // On desktop the user's persisted sidebarW is always respected —
  // entering focus mode should not change horizontal layout.
  const effectiveSidebarW = sidebarCollapsed
    ? COLLAPSED_SIDEBAR_W
    : viewport.isMobile
      ? Math.max(130, viewport.width - colW * 1.6 - 8)
      : sidebarW;

  // ─── Selection ─────────────────────────────────────────────────────
  // Two modes:
  //   cells: spreadsheet-style cell selection scoped to a single item; arrow
  //          shifts move just those step cells.
  //   items: whole-item selection (one or many); each item is treated as a
  //          unit — arrow shifts and drags translate every selected item by
  //          the same delta.
  type Selection =
    | {
        kind: "cells";
        itemId: string;
        /** The cell the user single-clicked to start the selection.
         *  Shift-clicks paint from anchor → clicked (Excel-style).
         *  Optional for back-compat with selections built outside
         *  selectCell (e.g. marquee). */
        anchorStepId?: string;
        stepIds: Set<string>;
        includeDeadline?: boolean;
        /** Where the click originated — drives mutually-exclusive
         *  selection visuals: clicking a timeline cell rings the
         *  cell, clicking the sidebar paints the row outline. */
        source?: "timeline" | "sidebar";
      }
    | { kind: "items"; itemIds: Set<string> };
  const [selection, setSelection] = useState<Selection | null>(null);
  // Excel-style "marching ants" set: step IDs the user just copied
  // with ⌘C. Renders a dashed border on those cells until the user
  // pastes, presses Escape, or starts a new selection. Declared here
  // (above clearSelection) so the setter isn't referenced before its
  // binding exists.
  const [copiedStepIds, setCopiedStepIds] = useState<Set<string>>(new Set());
  // Escape / "full clear" — drops both the painted selection and the
  // marching-ants set. Used by the Escape key.
  const clearSelection = useCallback(() => {
    setSelection(null);
    setCopiedStepIds(new Set());
  }, []);
  // Plain-click drop — only the painted selection goes away; the
  // marching ants from the most recent ⌘C persist (Excel behavior:
  // ants stay until you paste or hit Escape, so you can navigate /
  // click around without losing your clipboard set).
  const dropPaintedSelection = useCallback(() => {
    setSelection(null);
  }, []);
  const selectedItemIds = useMemo(
    () =>
      selection?.kind === "items"
        ? selection.itemIds
        : selection?.kind === "cells"
          ? new Set([selection.itemId])
          : new Set<string>(),
    [selection],
  );

  /** Pointer-down on a cell. Single-cell click semantics (with modifiers). */
  function onCellPointerDown(
    itemId: string,
    stepId: string,
    e: CellPointerInit,
    source: "timeline" | "sidebar" = "timeline",
  ) {
    if (e.button !== 0) return;
    const mode: "replace" | "extend" | "toggle" = e.shiftKey
      ? "extend"
      : e.metaKey || e.ctrlKey
        ? "toggle"
        : "replace";
    selectCell(itemId, stepId, mode, source);
  }

  // ─── Marquee lasso (spreadsheet-style rectangle select) ─────────────
  // Two modes, chosen by what the lasso touches:
  //   items: ANY item header bar touched → multi-item selection containing
  //          every touched bar. Works across blocks and across collapsed-
  //          summary bars. Arrow-shift / drag move every selected item by
  //          the same delta — the "move 10 at once" path.
  //   cells: only step cells / the deadline cell touched (no bars) →
  //          scoped to the first item; just those cells move.
  const { onPointerDown: marqueePointerDown, lasso } = useMarquee({
    targetSelector:
      "[data-cell-step-id], [data-cell-deadline-item-id], [data-cell-item-bar]",
    // Also ignore any pointer-down on the sticky-left sidebar — dragging
    // step rows around or fiddling with item titles in the sidebar
    // shouldn't start a lasso selection on the grid.
    ignoreSelector:
      "[data-cell-step-id], [data-cell-deadline-item-id], [data-cell-item-bar], [data-gantt-sidebar]",
    onIntersect: (matched) => {
      const itemIds = new Set<string>();
      let scopeItem: string | null = null;
      const stepIds = new Set<string>();
      let includeDeadline = false;
      for (const el of matched) {
        if (el.dataset.cellItemBar) {
          itemIds.add(el.dataset.cellItemBar);
          continue;
        }
        const itemId = el.dataset.cellItemId || el.dataset.cellDeadlineItemId;
        if (!itemId) continue;
        if (!scopeItem) scopeItem = itemId;
        if (itemId !== scopeItem) continue;
        if (el.dataset.cellStepId) stepIds.add(el.dataset.cellStepId);
        if (el.dataset.cellDeadlineItemId) includeDeadline = true;
      }
      if (itemIds.size > 0) {
        setSelection({ kind: "items", itemIds });
      } else if (scopeItem && (stepIds.size > 0 || includeDeadline)) {
        setSelection({
          kind: "cells",
          itemId: scopeItem,
          stepIds,
          includeDeadline,
        });
      } else {
        setSelection(null);
      }
    },
  });

  // Clicking blank Gantt space (anywhere that doesn't start a drag/marquee
  // on a real target) clears the selection. Without this, you'd have to
  // press Esc every time. If a marquee drag does happen, the onIntersect
  // above replaces the selection a few ms later, so this is a no-op.
  function onGanttBodyPointerDown(e: React.PointerEvent) {
    if (e.button === 0) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-step-sidebar]")) return;

      // Clicking directly on a deadline chip should select it so arrow keys
      // move it — without this the body handler clears selection first and
      // the marquee ignores the click (deadline chips are in ignoreSelector).
      const deadlineEl = t?.closest(
        "[data-cell-deadline-item-id]",
      ) as HTMLElement | null;
      if (deadlineEl?.dataset.cellDeadlineItemId) {
        setSelection({
          kind: "cells",
          itemId: deadlineEl.dataset.cellDeadlineItemId,
          stepIds: new Set(),
          includeDeadline: true,
        });
        return;
      }

      setSelection(null);
    }
    if (viewport.isMobile) return;
    marqueePointerDown(e);
  }
  const [, startTransition] = useTransition();
  /**
   * Every server write in this component goes through here, and it exists to keep
   * that true: one place to look when a change does not stick.
   *
   * The optimistic setState has already run by the time this is called — that
   * ordering (recordSnapshot → setState → persist) is what makes undo work and
   * what makes the board feel instant. `startTransition` keeps the write off the
   * urgent lane so a burst of drags never blocks paint.
   *
   * `opts.keys` and `opts.coalesceKey` are accepted and ignored. They named the
   * rows a write touched, for machinery a networked deployment needed and a local
   * one does not. They stay in the signature because 30 call sites pass them and
   * removing them buys nothing while touching every caller.
   *
   * ⚠️ ACCEPTED CONSEQUENCE, written down so it is not re-litigated: a write that
   * throws is logged and the optimistic state is NOT rolled back, so the UI can
   * diverge from disk until the next navigation re-reads it. A local SQLite write
   * fails only on a real bug or a full disk; the alternative — a permanently
   * green "saved" indicator — is a lie by omission, which is why there is no
   * write-status indicator in the UI at all.
   */
  const persist = useCallback(
    (
      fn: () => void | Promise<unknown>,
      _opts?: { keys?: string[]; coalesceKey?: string },
    ) => {
      startTransition(() => {
        void Promise.resolve(fn()).catch((e) =>
          console.error("[board] write failed", e),
        );
      });
    },
    [startTransition],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track which block section sits directly under the sticky header: probe the
  // point 1px below the header's bottom edge and find the section spanning it.
  // Drives the pinned block-header slot in the date-header band. rAF-throttled;
  // React bails out of same-value setState so idle scrolling costs nothing.
  useEffect(() => {
    if (view !== "gantt") return;
    const sc = scrollRef.current;
    if (!sc) return;
    const measure = () => {
      const header = sc.querySelector<HTMLElement>("[data-gantt-header]");
      const bandBottom =
        header?.getBoundingClientRect().bottom ??
        sc.getBoundingClientRect().top;
      // The slot is the DATE row — the last DATE_ROW_H px of the sticky band.
      const slotTop = bandBottom - DATE_ROW_H;
      const sections = Array.from(
        sc.querySelectorAll<HTMLElement>("[data-block-section]"),
      )
        .map((el) => ({
          id: el.dataset.blockSection ?? null,
          r: el.getBoundingClientRect(),
        }))
        .sort((a, b) => a.r.top - b.r.top);
      // Current = the section spanning the slot's TOP edge (it stays current
      // until an incoming section's inline header has fully traversed the
      // slot). Fallbacks: deep below all sections → the last one above;
      // scrolled to the very top → the first section.
      let current: string | null = null;
      for (const s of sections) {
        if (s.r.top <= slotTop + 1 && s.r.bottom > slotTop + 1) current = s.id;
      }
      if (current === null) {
        for (const s of sections)
          if (s.r.bottom <= slotTop + 1) current = s.id;
      }
      if (current === null) current = sections[0]?.id ?? null;
      // Incoming = a DIFFERENT section whose top is inside the slot window —
      // i.e. its inline header is mid-way through sliding under the band.
      let incoming: string | null = null;
      let t = DATE_ROW_H;
      for (const s of sections) {
        if (
          s.id !== current &&
          s.r.top > slotTop &&
          s.r.top <= bandBottom - 1
        ) {
          incoming = s.id;
          // Quantize to DEVICE pixels: the band bottom sits at a fractional y
          // (rem paddings at the 90% root font-size), so the raw offset is
          // fractional — a GPU-composited layer at a fractional translate and
          // the CPU-rasterized inline header snap differently, leaving a
          // sub-pixel seam between the two halves. Rounding to the device
          // grid keeps them fused.
          const dpr = window.devicePixelRatio || 1;
          t = Math.max(
            0,
            Math.min(
              DATE_ROW_H,
              Math.round((s.r.top - slotTop) * dpr) / dpr,
            ),
          );
          break;
        }
      }
      // Window mechanic: the slot renders the incoming inline header's
      // band-hidden portion at its TRUE position (translateY(t)), while the
      // still-visible portion below the band stays the real inline header —
      // the two halves read as ONE element travelling through the slot. The
      // current header is pushed out in tandem. React re-renders only on the
      // discrete id swaps; this runs per scroll frame.
      setPinnedBlockId(current);
      setUpcomingBlockId(incoming);
      const curEl = sc.querySelector<HTMLElement>("[data-pinned-current]");
      if (curEl)
        curEl.style.transform = incoming
          ? `translateY(${t - DATE_ROW_H}px)`
          : "translateY(0px)";
      const nextEl = sc.querySelector<HTMLElement>("[data-pinned-next]");
      if (nextEl) nextEl.style.transform = `translateY(${t}px)`;
    };
    measurePinnedBlockRef.current = measure;
    // Synchronous, NOT rAF-deferred: scroll listeners fire before paint, so a
    // direct write lands the slot transforms in the SAME frame the content
    // moved. An rAF hop puts the two halves one frame apart — visible jitter
    // during the pass-through. The writes are composite-only (transform), so
    // the rect reads here don't thrash layout.
    const onScroll = () => measure();
    sc.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      sc.removeEventListener("scroll", onScroll);
      measurePinnedBlockRef.current = () => {};
    };
  }, [view]);
  // Layout can change without a scroll (collapse a block, add rows) — re-probe
  // after every commit. useLayoutEffect so the transforms are correct BEFORE
  // the commit paints (an async effect lets a wrong-transform frame flash at
  // the swap moments). Cheap: a handful of getBoundingClientRect calls.
  useLayoutEffect(() => {
    measurePinnedBlockRef.current();
  });
  // Last known gantt horizontal scroll. The gantt scroller lives inside
  // `{view === "gantt" && …}`, so switching to week/day UNMOUNTS it; on return
  // it remounted at scrollLeft 0 (the far-past left edge) because the
  // scroll-to-today effect is mount-once. Record every scroll and restore on
  // re-entry so the user comes back to where they were.
  const ganttScrollLeftRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (view !== "gantt") return;
    const sc = scrollRef.current;
    if (!sc || ganttScrollLeftRef.current == null) return;
    sc.scrollLeft = ganttScrollLeftRef.current;
  }, [view]);
  const dialogs = useDialogs();

  const [blockModal, setBlockModal] = useState<{ block?: Block } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  /**
   * Open the ⌘K "search everything" palette. Shared by the ⌘K shortcut and
   * the date-header search button.
   */
  function requestSearch() {
    setSearchOpen(true);
  }
  /** Item to flash-highlight after a search jump. Cleared via timeout. */
  // Search / jump affordance: flashes a *date column* (not the task
  // bar) so the user sees "here's the day this thing sits on" rather
  // than "here's a horizontal stripe across the whole row" — the
  // column is the natural unit since both search results and the
  // "see tomorrow" CTA point at a specific day.
  const [flashDayISO, setFlashDayISO] = useState<string | null>(null);
  // Companion to flashDayISO: when a *task* is the jump target (⌘K
  // search hit, pinned-item chip), also flash the row horizontally so
  // the user sees both "which day" (column) and "which task" (row).
  // Cleared by the same timer.
  const [flashItemId, setFlashItemId] = useState<string | null>(null);

  // "Rows are on the clipboard from our app" — survives Escape so the
  // user can dismiss the marching-ants visual but still ⌘V the rows
  // somewhere else later (Excel behavior). Cleared only after an
  // actual paste, or when a new ⌘C overwrites it.
  const copyAvailableRef = useRef(false);
  // The cell that should anchor the next shift-click range fill. Lives
  // outside React state so a plain click can stamp it without a re-
  // render (and without painting a single-cell selection the user
  // doesn't want to see while they're just typing).
  const cellAnchorRef = useRef<{ itemId: string; stepId: string } | null>(null);
  const recordCellAnchor = useCallback((itemId: string, stepId: string) => {
    cellAnchorRef.current = { itemId, stepId };
  }, []);
  // Per-item double-fire guard: suppress a second onAddStep within 350 ms of the first.
  const addStepGuardRef = useRef<Map<string, number>>(new Map());
  const [itemModal, setItemModal] = useState<{
    item?: Item;
    defaultBlockId?: string;
    defaultStart?: string;
    defaultDuration?: number;
  } | null>(null);
  const [deadlineModal, setDeadlineModal] = useState<{ date?: string } | null>(
    null,
  );
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [dateJumpOpen, setDateJumpOpen] = useState(false);

  /** Scroll to a specific ISO date, expanding the visible range if needed. */
  function jumpToDate(iso: string) {
    // Date-jump must also work from week/day view — the horizontal timeline
    // only exists in gantt view, so switch back first (no-op in gantt).
    if (view !== "gantt") setView("gantt");

    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const delta = daysBetween(toISODate(t), iso); // negative = past, positive = future

    // Compute the next range params once, so the state setters and the
    // scrollTo math below agree on the same window even when both branches
    // could grow.
    const needsPastGrowth = delta < 0 && Math.abs(delta) > pastDays - 1;
    const needsFutureGrowth = delta > 0 && delta > futureDays - 1;
    const nextPast = needsPastGrowth ? Math.abs(delta) + 7 : pastDays;
    if (needsPastGrowth) setCustomPastDays(nextPast);
    if (needsFutureGrowth) setCustomFutureDays(delta + 7);

    // Defer until the gantt scroll container is mounted (a view switch +
    // range-growth re-render can take a variable number of frames). Gate on
    // the container existing rather than a fixed double-rAF so it's race-free
    // across the view switch.
    const idx = nextPast + delta;
    let frames = 0;
    const MAX_FRAMES = 30;
    const tick = () => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          left: Math.max(0, idx * colW - 120),
          behavior: "smooth",
        });
        return;
      }
      if (frames++ < MAX_FRAMES) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * Toggle day-focus mode. Passing `today` toggles on/off; passing any
   * other date switches to that date (without un-focusing). Side effects:
   *   - clears the current selection (avoid stale selection from a hidden item).
   *   - expands the visible range if the date sits outside today's window
   *     (same growth logic as jumpToDate).
   */
  function toggleFocusedDay(iso: string) {
    if (focusedDayISO === iso) {
      setFocusedDayISO(null);
      return;
    }
    setSelection(null);
    setFocusedDayISO(iso);
    // Make sure the column is actually rendered. Re-use jumpToDate's
    // range-stretch logic so far-past / far-future days work too.
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const delta = daysBetween(toISODate(t), iso);
    const needsPast = delta < 0 && Math.abs(delta) > pastDays - 1;
    const needsFuture = delta > 0 && delta > futureDays - 1;
    const nextPast = needsPast ? Math.abs(delta) + 7 : pastDays;
    if (needsPast) setCustomPastDays(nextPast);
    if (needsFuture) setCustomFutureDays(delta + 7);
    // Scroll the focused column into view after the range update applies.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        const idx = nextPast + delta;
        scrollRef.current.scrollTo({
          left: Math.max(0, idx * colW - 120),
          behavior: "smooth",
        });
      });
    });
  }

  /**
   * Jump-and-flash for the search modal. Auto-expands the item's parent
   * block + the item itself if collapsed, scrolls the row into view, and
   * sets `flashItemId` to drive the 2-pulse green highlight overlay.
   *
   * `focusDate` is the date we try to land on horizontally. The search
   * modal passes the step's date for step-hits (so a step on today scrolls
   * to today, not to the item's far-back start_date) and the item's
   * start_date for item-hits.
   *
   * Past-range growth is intentionally NOT done here — the user's pastDays
   * setting is a hard ceiling. If the target sits before the visible
   * window, we clamp the X scroll to column 0 instead of spawning days.
   * Future-range growth is fine since that's the natural read direction.
   */
  function triggerJumpToItem(item: Item, focusDate?: string) {
    // A search/⌘K jump must work from ANY view. The gantt body — and the
    // [data-item-row] element we scroll to — only mounts in gantt view, so
    // switch back to it first. (No-op when already in gantt.)
    if (view !== "gantt") setView("gantt");

    setBlocks((prev) =>
      prev.map((b) =>
        b.id === item.block_id && b.collapsed ? { ...b, collapsed: false } : b,
      ),
    );
    setCollapsedItems((prev) => {
      if (!prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    const target = blocks.find((b) => b.id === item.block_id);
    if (item.block_id && target?.collapsed) {
      const bid = item.block_id;
      persist(() => updateBlock(bid, { collapsed: false }), {
        keys: ["blocks:" + bid],
      });
    }

    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const todayISOLocal = toISODate(t);
    const target_iso = focusDate ?? item.start_date;
    const targetDelta = daysBetween(todayISOLocal, target_iso);
    // Forward growth only — past stays bounded by the user's pastDays.
    const needsFuture = targetDelta > 0 && targetDelta > futureDays - 1;
    if (needsFuture) setCustomFutureDays(targetDelta + 7);

    // X: snap to target column inside the current (post-growth) window.
    // pastDays is stable across forward-growth (only futureDays changes), so
    // capturing it here is safe even though the range re-renders.
    const targetCol = pastDays + targetDelta;
    const targetLeft = Math.max(0, targetCol * colW - 120);

    // Defer the scroll until the gantt grid (and this item's row) is actually
    // in the DOM. A fixed double-rAF isn't enough when we just switched views
    // and/or grew the range — the grid mounts a variable number of frames
    // later. Gate on the DOM existing, not on a state value, so the poll is
    // race-free regardless of how long the view switch + re-render takes.
    runWhenGanttReady(item.id, (container, el) => {
      if (el) {
        const containerRect = container.getBoundingClientRect();
        const rowRect = el.getBoundingClientRect();
        const targetTop =
          container.scrollTop +
          (rowRect.top - containerRect.top) -
          containerRect.height / 2 +
          rowRect.height / 2;
        // Clamp negative → 0 so out-of-window targets just show the leftmost
        // visible part of the row instead of trying to scroll somewhere that
        // doesn't exist.
        container.scrollTo({
          top: Math.max(0, targetTop),
          left: targetLeft,
          behavior: "smooth",
        });
      }
      // Context-aware flash: a step hit (focusDate provided) points
      // at a specific day → flash the column. An item hit (no
      // focusDate) points at the whole task → flash the row. Both at
      // once would double-flash; only one matches the intent.
      if (focusDate !== undefined) {
        setFlashDayISO(target_iso);
      } else {
        setFlashItemId(item.id);
      }
    });
  }

  /**
   * Run `fn` once the gantt scroll container is mounted, passing the
   * container and the given item's row element (or null if the row isn't in
   * the DOM yet by the time the container is ready). Polls a few animation
   * frames (capped ~0.5s) so a view switch + range-growth re-render can
   * complete first. Replaces the previous fixed double-rAF, which raced the
   * async grid mount when a jump originated from week/day view.
   */
  function runWhenGanttReady(
    itemId: string,
    fn: (container: HTMLElement, el: HTMLElement | null) => void,
  ) {
    let frames = 0;
    const MAX_FRAMES = 30; // ~0.5s at 60fps — covers view switch + re-render
    const tick = () => {
      const container = scrollRef.current;
      const el = document.querySelector<HTMLElement>(
        `[data-item-row="${itemId}"]`,
      );
      // Fire as soon as the row exists. If the container is up but the row
      // still isn't after the cap, fire anyway so the day-column flash runs.
      if (container && (el || frames >= MAX_FRAMES)) {
        fn(container, el);
        return;
      }
      if (frames++ < MAX_FRAMES) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  useEffect(() => {
    if (!flashDayISO && !flashItemId) return;
    // Two CSS pulses at 0.55s each = ~1.1s; clear a touch after.
    const id = setTimeout(() => {
      setFlashDayISO(null);
      setFlashItemId(null);
    }, 1300);
    return () => clearTimeout(id);
  }, [flashDayISO, flashItemId]);

  // Apply theme to <html> + mirror to localStorage for no-flash boot.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("gantt:theme", theme);
    } catch {}
  }, [theme]);

  // Debounced DB persistence for the settings this board owns.
  // `sidebarCollapsed` is intentionally NOT persisted (session-only).
  //
  // ⚠️ DEBOUNCED, and that is not a nicety. `chipModeByBlock` and
  // `collapsedItems` change on every chevron click, and each one is now a
  // Server Action round trip rather than a synchronous localStorage write —
  // collapsing ten lanes in a row must cost one write, not ten.
  //
  // ⚠️ This patch is a DELTA and must stay one. `updateSettings` MERGES, so a
  // caller that posted a whole hydrated settings object would rewrite every
  // field from its own snapshot and silently revert whatever was changed
  // elsewhere — the measured failure `settingsDelta` exists to stop. Eight
  // named keys, all of them owned by this component, is the delta.
  //
  // `collapsedItemIds` is SORTED on the way out so the comparison below is
  // order-independent: a Set iterates in insertion order, and re-collapsing
  // the same two items in the other order is not a change worth a write.
  const collapsedItemIds = useMemo(
    () => Array.from(collapsedItems).sort(),
    [collapsedItems],
  );
  const settingsPatch = useMemo(
    () => ({
      colW,
      rowH,
      sidebarW,
      theme,
      pinnedItemIds,
      chipModeByBlock,
      collapsedItemIds,
      lastBlockId,
    }),
    [
      colW,
      rowH,
      sidebarW,
      theme,
      pinnedItemIds,
      chipModeByBlock,
      collapsedItemIds,
      lastBlockId,
    ],
  );
  /**
   * ⚠️ **The baseline is what was last WRITTEN, never the `settings` prop.**
   *
   * `settings` is a server-render snapshot and nothing in this application
   * refreshes it: Next's path- and tag-revalidation helpers are absent by
   * design — `tests/no-cloud-imports.test.ts` forbids the first of them BY
   * NAME, so writing it here reds that guard — and this route never calls
   * `router.refresh()`. So the prop still holds the values the page loaded
   * with long after a write has landed.
   *
   * Comparing against it asks "does this differ from disk AT PAGE LOAD", and a
   * value changed and then changed BACK inside one page life answers *no* — so
   * the corrective write is skipped and the row keeps the intermediate value.
   * MEASURED, on a freshly-loaded board carrying one task: collapse its steps
   * (`collapsedItemIds` becomes `["<id>"]` on disk), expand them again, and no
   * further write is issued — the next launch reopens the task collapsed,
   * silently discarding the last thing the person did. The collapse chevron is
   * the most round-tripped control on the board, which is what makes this an
   * everyday loss rather than an edge; toggling the theme twice loses the
   * second toggle the same way.
   *
   * `components/settings-form.tsx` keeps exactly this kind of baseline for
   * exactly this reason. Those two are the only callers of `updateSettings`
   * that hold state across renders, and they have to agree.
   *
   * Seeded from the FIRST render's patch, whose every field is state seeded
   * straight from `settings` — i.e. what is on disk — so mounting still writes
   * nothing. MEASURED: 0 Server Actions over 10s on an idle open board.
   */
  const lastSavedRef = useRef<string>(JSON.stringify(settingsPatch));
  useEffect(() => {
    const serialized = JSON.stringify(settingsPatch);
    if (serialized === lastSavedRef.current) return;
    const id = setTimeout(() => {
      // Advanced as the write goes out rather than after it resolves, which
      // matches `persist()`'s documented posture everywhere else in this file:
      // it logs a failure and does not roll back. Nothing is stranded by that
      // here — this patch carries all eight keys every time, so the next change
      // to any one of them re-sends the others.
      lastSavedRef.current = serialized;
      persist(() => {
        updateSettings(settingsPatch);
      });
    }, 400);
    return () => clearTimeout(id);
  }, [settingsPatch, persist]);
  /**
   * ⚠️ **The debounce above is CANCELLED by its own cleanup, so a departure
   * inside the 400 ms window loses the write.** MEASURED on the standalone
   * build, with this flush removed and nothing else changed: expand a task's
   * steps and click "Settings" in the top bar straight away — the board
   * unmounts, `clearTimeout` fires, **no Server Action is issued at all**, and
   * the board comes back collapsed. Every one of the eight keys this patch
   * carries is exposed the same way; the collapse chevron is simply the one
   * that is easiest to drive. `e2e/ui-state.spec.ts`'s fourth test is exactly
   * that sequence.
   *
   * The flush re-uses `lastSavedRef`, so it is a no-op whenever the timer
   * already fired — `pagehide` and unmount can both fire for one departure and
   * this must not become two writes. It is deliberately NOT routed through
   * `persist()`: that starts a transition on a component that is in the middle
   * of unmounting, and the `.catch` it provides is the only thing this needs.
   */
  useFlushOnUnload(() => {
    const serialized = JSON.stringify(settingsPatch);
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;
    void updateSettings(settingsPatch).catch((e) =>
      console.error("[board] settings flush failed", e),
    );
  });

  // Date window. Custom overrides (set by jumpToDate) can stretch either edge
  // beyond the defaults so historic / far-future jumps land somewhere visible.
  const [customPastDays, setCustomPastDays] = useState<number | null>(null);
  const [customFutureDays, setCustomFutureDays] = useState<number | null>(null);
  // How many past days are needed to show the farthest-back undone step.
  // If the user falls behind, this ensures stale tasks are never silently
  // hidden behind the collapsed past view.
  const stalePastDays = useMemo(() => {
    const todayISO = toISODate(new Date());
    const blockIds = new Set(blocks.map((b) => b.id));
    // Only items that live in an existing block are rendered. Orphaned items
    // (block_id null, or pointing to a deleted block) show in no lane, so their
    // stale undone steps must NOT stretch the past range — otherwise invisible
    // rows drag the board weeks backwards with empty, blockless columns.
    // Recurring series are exempt too: a skipped habit shouldn't drag the
    // board into the past — missed occurrences just scroll by.
    const itemStart = new Map(
      items
        .filter(
          (it) =>
            it.block_id !== null &&
            blockIds.has(it.block_id) &&
            !it.recurrence,
        )
        .map((it) => [it.id, it.start_date]),
    );
    let maxBack = 0;
    for (const s of steps) {
      if (s.status === "done") continue;
      const start = itemStart.get(s.item_id);
      if (!start) continue;
      const stepISO = toISODate(
        addDays(new Date(start + "T00:00:00"), s.day_offset),
      );
      if (stepISO >= todayISO) continue; // today or future — already visible
      const daysBack = daysBetween(stepISO, todayISO);
      if (daysBack > maxBack) maxBack = daysBack;
    }
    return maxBack;
  }, [items, steps, blocks]);

  const pastDays = Math.max(
    customPastDays ?? (showPast ? PAST_DAYS_EXPANDED : PAST_DAYS_DEFAULT),
    stalePastDays,
  );
  const futureDays = customFutureDays ?? FUTURE_DAYS;
  // ─── Recurring-series materialization ──────────────────────────────
  // Series are "infinite" but stored finite: occurrences only exist out to a
  // rolling window (MATERIALIZE_AHEAD_DAYS), and something has to extend them.
  //
  // That something is `instrumentation.ts`, which runs one pass per server
  // process — i.e. once per app launch, before the first request. There is no
  // cron and there does not need to be one: the only reader of a board's steps
  // is this window, so a series that is never looked at never needs extending,
  // and looking at it means launching the app.
  //
  // This effect covers the one case a launch pass cannot: a machine left open
  // longer than the window. It fires on tab wake, not on mount — the launch
  // pass already ran, so a mount call would be a redundant write performed by
  // a render. `shouldMaterialize` (lib/calendar/materialize-trigger.ts) holds
  // the interval so the predicate is testable; this file is not.
  const lastMaterializeRef = useRef(0);
  const runMaterialize = useCallback(() => {
    if (!items.some((it) => it.recurrence)) return;
    if (!shouldMaterialize(lastMaterializeRef.current, Date.now())) return;
    lastMaterializeRef.current = Date.now();
    // Materialization is system growth, not a user edit: it has no undo
    // snapshot, no sound, and nothing to surface. A failure costs a delay,
    // never data — the next launch runs the same pass.
    void materializeBoardSeries(activeBoardId).catch(() => {});
  }, [items, activeBoardId]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") runMaterialize();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [runMaterialize]);

  const { rangeStart, days, dayISOs, gridWidth } = useMemo(() => {
    const start = addDays(new Date(), -pastDays);
    start.setHours(0, 0, 0, 0);
    const ds = buildDateRange(start, pastDays + futureDays);
    return {
      rangeStart: start,
      days: ds,
      dayISOs: ds.map(toISODate),
      gridWidth: ds.length * colW,
    };
  }, [pastDays, futureDays, colW]);

  const rangeStartISO = useMemo(() => toISODate(rangeStart), [rangeStart]);
  const todayIndex = useMemo(() => days.findIndex((d) => isToday(d)), [days]);

  // "Auto-scroll to today on load" — load only. This must NOT re-fire on
  // later todayIndex changes: todayIndex moves whenever pastDays does, and
  // pastDays is data-derived (stalePastDays), so re-firing would yank the
  // viewport to today every time a mutation touched the oldest stale step.
  const didAutoScrollToTodayRef = useRef(false);
  useEffect(() => {
    if (didAutoScrollToTodayRef.current) return;
    if (!settings.autoScrollToToday) return;
    if (!scrollRef.current || todayIndex < 0) return;
    didAutoScrollToTodayRef.current = true;
    scrollRef.current.scrollLeft = Math.max(0, todayIndex * colW - 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayIndex]);

  // Keep the viewport anchored on the same date when the past range
  // grows/shrinks. Day columns are prepended/removed at the LEFT edge, so
  // without compensating scrollLeft by the width delta, everything under
  // the cursor shifts sideways whenever pastDays changes (add/delete/
  // complete touching the oldest stale step, the show-past toggle, …).
  // Layout effect so the correction lands in the same paint as the new
  // columns. jumpToDate/toggleFocusedDay still win: they set an absolute
  // scrollLeft in post-growth coordinates from a later rAF.
  const prevPastDaysRef = useRef(pastDays);
  useLayoutEffect(() => {
    const prev = prevPastDaysRef.current;
    if (prev === pastDays) return;
    prevPastDaysRef.current = pastDays;
    const sc = scrollRef.current;
    if (!sc) return;
    sc.scrollLeft = Math.max(0, sc.scrollLeft + (pastDays - prev) * colW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastDays]);

  // Keyboard shortcuts (with G-prefix sequences like Google Calendar)
  const gPendingRef = useRef<number | null>(null);
  const stepsByItem = useMemo(() => {
    const m = new Map<string, Step[]>();
    for (const it of items) m.set(it.id, []);
    for (const s of steps) {
      const a = m.get(s.item_id);
      if (a) a.push(s);
    }
    for (const a of m.values()) a.sort((x, y) => x.day_offset - y.day_offset);
    return m;
  }, [items, steps]);

  // "All today's tasks done" detection. A step is "today's" if its
  // computed date (item.start_date + day_offset) is today. We only fire the
  // celebration when the last remaining today-step flips done — not on
  // initial load and not when the count is zero.
  const itemsById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);
  const todayISO = useMemo(() => toISODate(new Date()), []);
  // "Today's tasks" = non-done steps whose computed date is today. Matches
  // exactly what the calendar shows: when the visible count hits zero, we
  // fire. Done steps don't count — otherwise multi-day items whose middle
  // days are already done would inflate the total above what the user sees
  // as "open today".
  const todayTodoCount = useMemo(() => {
    const blockIds = new Set(blocks.map((b) => b.id));
    let count = 0;
    for (const s of steps) {
      if (s.status === "done") continue;
      const it = itemsById.get(s.item_id);
      if (!it) continue;
      // Skip orphans — items whose block was deleted. The calendar hides
      // these the same way, so they shouldn't gate the all-done celebration.
      if (it.block_id !== null && !blockIds.has(it.block_id)) continue;
      const date = isoAtOffset(it.start_date, s.day_offset);
      if (date === todayISO) count++;
    }
    return count;
  }, [steps, blocks, itemsById, todayISO]);
  const hadTodayWorkRef = useRef<boolean>(todayTodoCount > 0);
  const [allDonePopup, setAllDonePopup] = useState(false);
  useEffect(() => {
    if (todayTodoCount === 0 && hadTodayWorkRef.current) {
      sfx.allTasksComplete();
      setAllDonePopup(true);
    }
    hadTodayWorkRef.current = todayTodoCount > 0;
  }, [todayTodoCount]);
  useEffect(() => {
    if (!allDonePopup) return;
    const id = setTimeout(() => setAllDonePopup(false), 6000);
    return () => clearTimeout(id);
  }, [allDonePopup]);

  // Whenever a real selection becomes active, blur whatever input
  // currently owns the caret. Otherwise the user sees a blinking caret
  // inside a step label while ⌘C / ⌘V is supposed to operate on the
  // multi-cell / multi-item selection — confusing and it lets the
  // browser's text-paste path swallow the shortcut.
  useEffect(() => {
    if (!selection) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      el.blur();
    }
  }, [selection]);

  /**
   * Select a cell with click semantics. mode: replace | extend | toggle.
   *
   * Selection is anchored: single-clicks set the anchor; shift-clicks
   * paint range = anchor → clicked (Excel/Sheets behavior). Without
   * the anchor the previous min/max logic let the selection silently
   * drift — once you'd shift-clicked into 1–5, clicking back at 3 did
   * nothing because both ends were already past 3.
   */
  function selectCell(
    itemId: string,
    stepId: string,
    mode: "replace" | "extend" | "toggle",
    source: "timeline" | "sidebar" = "timeline",
  ) {
    setSelection((prev) => {
      const itemSteps = stepsByItem.get(itemId) ?? [];
      const clicked = itemSteps.find((s) => s.id === stepId);
      if (!clicked) return prev;

      const prevSameItem =
        prev && prev.kind === "cells" && prev.itemId === itemId ? prev : null;
      const prevAnchorId = prevSameItem?.anchorStepId ?? null;
      const refAnchorId =
        cellAnchorRef.current && cellAnchorRef.current.itemId === itemId
          ? cellAnchorRef.current.stepId
          : null;
      const anchorId = prevAnchorId ?? refAnchorId ?? stepId;
      const anchor = itemSteps.find((s) => s.id === anchorId) ?? clicked;

      if (mode === "replace") {
        return {
          kind: "cells",
          itemId,
          anchorStepId: stepId,
          stepIds: new Set([stepId]),
          source,
        };
      }
      if (mode === "toggle") {
        const baseIds = prevSameItem?.stepIds ?? new Set<string>();
        const next = new Set(baseIds);
        if (next.has(stepId)) next.delete(stepId);
        else next.add(stepId);
        return next.size === 0
          ? null
          : {
              kind: "cells",
              itemId,
              anchorStepId: prevAnchorId ?? stepId,
              stepIds: next,
              source,
            };
      }
      // extend (shift): fill day_offset range from anchor → clicked.
      const lo = Math.min(anchor.day_offset, clicked.day_offset);
      const hi = Math.max(anchor.day_offset, clicked.day_offset);
      const next = new Set<string>();
      for (const s of itemSteps) {
        if (s.day_offset >= lo && s.day_offset <= hi) next.add(s.id);
      }
      return {
        kind: "cells",
        itemId,
        anchorStepId: anchor.id,
        stepIds: next,
        source,
      };
    });
  }

  /**
   * Click-select an item bar (expanded or collapsed-summary).
   *  - replace: items-mode containing just this one.
   *  - toggle (cmd/ctrl): add if missing, remove if present; clears at zero.
   *  - extend (shift): items-mode union including this one. Items lack a
   *    natural total order, so this just adds — same as toggle-on.
   */
  function selectItem(itemId: string, mode: "replace" | "extend" | "toggle") {
    setSelection((prev) => {
      if (mode === "replace") {
        return { kind: "items", itemIds: new Set([itemId]) };
      }
      const base =
        prev?.kind === "items" ? new Set(prev.itemIds) : new Set<string>();
      if (mode === "toggle") {
        if (base.has(itemId)) base.delete(itemId);
        else base.add(itemId);
        return base.size === 0 ? null : { kind: "items", itemIds: base };
      }
      base.add(itemId);
      return { kind: "items", itemIds: base };
    });
  }

  /**
   * Apply computeShift to a single item with the given selection mask.
   * Updates client state optimistically and queues the server write.
   * Returns true if anything changed.
   */
  function applyShiftToItem(
    itemId: string,
    movingStepIds: Set<string>,
    movingDeadline: boolean,
    delta: number,
  ): boolean {
    const item = items.find((i) => i.id === itemId);
    if (!item) return false;
    // Only undone steps participate in shifting and set the deadline floor.
    const itemSteps = (stepsByItem.get(itemId) ?? []).filter(
      (s) => s.status !== "done",
    );
    const result = computeShift({
      item,
      itemSteps,
      movingStepIds,
      movingDeadline,
      delta,
    });
    if (result.noop) return false;
    const { stepUpdates, newDuration, newStartDate, newDeadlineOffset } =
      result;
    if (stepUpdates.length) {
      const updatesById = new Map(stepUpdates.map((u) => [u.id, u.day_offset]));
      setSteps((p) =>
        p.map((s) =>
          updatesById.has(s.id)
            ? { ...s, day_offset: updatesById.get(s.id)! }
            : s,
        ),
      );
    }
    if (
      newStartDate !== undefined ||
      newDuration !== undefined ||
      newDeadlineOffset !== undefined
    ) {
      setItems((p) =>
        p.map((i) =>
          i.id === item.id
            ? {
                ...i,
                ...(newStartDate !== undefined
                  ? { start_date: newStartDate }
                  : {}),
                ...(newDuration !== undefined
                  ? { duration_days: newDuration }
                  : {}),
                ...(newDeadlineOffset !== undefined
                  ? { deadline_offset: newDeadlineOffset }
                  : {}),
              }
            : i,
        ),
      );
    }
    // ⚠️ STANDING PROHIBITION: never add an expected-version argument to
    // `applyItemMove` (or to `resizeItem`). This app has exactly one writer —
    // the window in front of you — so there is no second version to compare
    // against and every rejection such a guard could produce would be a FALSE
    // one, silently discarding a drag the user just made. The same rule holds
    // for `onUpdateStep`; the note above it says so.
    persist(
      () =>
        applyItemMove({
          itemId: item.id,
          stepUpdates,
          newStartDate,
          newDuration,
          newDeadlineOffset,
          // 0 because the rule genuinely did not change — this is a drag/shift,
          // not a rotation. That is a FACT about this call site, not a default
          // standing in for one nobody supplied: `origin_day_offset` must FREEZE
          // here, and the RPC rebases it only by the item's start_date delta.
          // Stated explicitly because a rotation reaches this same function in
          // the identical shape and needs the opposite.
          ruleDelta: 0,
        }),
      {
        keys: [
          "items:" + item.id,
          ...stepUpdates.map((u) => "steps:" + u.id),
        ],
        coalesceKey: "move:" + item.id,
      },
    );
    return true;
  }

  /**
   * Shift selection by ±1 day.
   *  - cells mode: shift only the selected step cells of one item.
   *  - items mode: shift every selected item bodily (all its steps + deadline).
   */
  function shiftSelection(delta: -1 | 1) {
    if (!selection) return;
    // One snapshot per arrow press — even if it fans out across N items.
    recordSnapshot();
    if (selection.kind === "cells") {
      applyShiftToItem(
        selection.itemId,
        selection.stepIds,
        !!selection.includeDeadline,
        delta,
      );
      return;
    }
    // items mode: every item moves as a unit.
    for (const itemId of selection.itemIds) {
      const allStepIds = new Set(
        (stepsByItem.get(itemId) ?? []).map((s) => s.id),
      );
      applyShiftToItem(itemId, allStepIds, true, delta);
    }
  }

  /**
   * Move the selection cursor up/down within the item. Only meaningful for
   * cells mode; items mode is a no-op (Up/Down across multiple items would
   * need a richer cursor model).
   */
  function moveSelectionCursor(delta: -1 | 1) {
    if (!selection || selection.kind !== "cells") return;
    const itemSteps = stepsByItem.get(selection.itemId) ?? [];
    const ordered = [...itemSteps].sort((a, b) => a.day_offset - b.day_offset);
    // anchor = topmost selected when moving up, bottommost when moving down
    const anchorIds = new Set(selection.stepIds);
    const anchorIdx =
      delta < 0
        ? ordered.findIndex((s) => anchorIds.has(s.id))
        : (() => {
            let last = -1;
            ordered.forEach((s, i) => {
              if (anchorIds.has(s.id)) last = i;
            });
            return last;
          })();
    const nextIdx = anchorIdx + delta;
    if (nextIdx < 0 || nextIdx >= ordered.length) return;
    setSelection({
      kind: "cells",
      itemId: selection.itemId,
      stepIds: new Set([ordered[nextIdx].id]),
    });
  }

  /**
   * Shared cells-copy used by both the regular ⌘C path and the
   * input-focused intercept. Pulls labels (+ effort minutes when any
   * step has them) from the given selection, writes to the OS
   * clipboard, stamps the marching-ants visual via copiedStepIds,
   * and drops the active selection so the cells transition to the
   * copied-only look.
   */
  function runCellsCopy(sel: {
    kind: "cells";
    itemId: string;
    stepIds: Set<string>;
  }) {
    const stepsById = new Map(steps.map((s) => [s.id, s]));
    const selectedSteps = Array.from(sel.stepIds)
      .map((id) => stepsById.get(id))
      .filter((s): s is Step => !!s)
      .sort((a, b) => a.day_offset - b.day_offset);
    if (selectedSteps.length === 0) return;
    const anyEffort = selectedSteps.some((s) => s.duration_min != null);
    const text = selectedSteps
      .map((s) => (anyEffort ? `${s.label}\t${s.duration_min ?? ""}` : s.label))
      .join("\n");
    void navigator.clipboard.writeText(text);
    sfx.copied();
    setCopiedStepIds(new Set(selectedSteps.map((s) => s.id)));
    copyAvailableRef.current = true;
    cellAnchorRef.current = {
      itemId: sel.itemId,
      stepId: selectedSteps[0].id,
    };
    setSelection(null);
  }

  /**
   * Shared paste pipeline used by both the cell-selection ⌘V branch
   * and the input-focused ⌘V hijack. Reads the clipboard, expands the
   * given anchor step to clipboard.rows count along day_offset within
   * the anchor's item, then applies label/effort patches row-by-row.
   * Stops at the last step of the item (no auto-create) so a 10-row
   * paste into a 5-day item simply pastes the first 5.
   */
  function pasteCellsFromAnchor(anchorStepId: string) {
    const anchor = steps.find((s) => s.id === anchorStepId);
    if (!anchor) return;
    void (async () => {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return;
      }
      if (!text) return;
      const rows = text.replace(/\r\n/g, "\n").split("\n");
      while (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
      if (rows.length === 0) return;
      const itemSteps = (stepsByItem.get(anchor.item_id) ?? [])
        .slice()
        .sort((a, b) => a.day_offset - b.day_offset);
      const anchorIdx = itemSteps.findIndex((s) => s.id === anchor.id);
      if (anchorIdx < 0) return;
      const targets = itemSteps.slice(anchorIdx, anchorIdx + rows.length);
      recordSnapshot();
      sfx.pasted();
      targets.forEach((s, i) => {
        const cols = rows[i].split("\t");
        const label = cols[0];
        const patch: Partial<Step> = { label };
        if (cols.length > 1) {
          const n = parseInt(cols[1], 10);
          if (!isNaN(n) && n >= 0 && n <= 1440) {
            patch.duration_min = n;
          } else if (cols[1].trim() === "") {
            patch.duration_min = null;
          }
        }
        onUpdateStep(s.id, patch);
      });
      setCopiedStepIds(new Set());
      copyAvailableRef.current = false;
    })();
  }

  // Keyboard shortcuts. The handler closes over a lot of state/callbacks; we
  // route through a ref so the window listener is registered exactly once and
  // never reads a stale closure.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    {
      const t = e.target as HTMLElement;
      const editing =
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable;

      // ⌘C while a cells selection exists — even from a focused
      // step-label input. The user just selected a range and wants
      // to copy it; the focused input is a stale side-effect of the
      // earlier click that started the selection chain.
      if (
        editing &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "c" &&
        selection?.kind === "cells" &&
        selection.stepIds.size > 0
      ) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        runCellsCopy(selection);
        return;
      }

      // ⌘C inside a step-label input with NO text highlighted (just a
      // blinking caret): copy the whole label, the way a spreadsheet copies
      // the active cell without you having to select its text first. If the
      // user *has* highlighted a range, we fall through to the browser's
      // native copy so partial-selection copy still works.
      if (
        editing &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "c" &&
        t.tagName === "INPUT" &&
        (t as HTMLInputElement).dataset.stepId
      ) {
        const inp = t as HTMLInputElement;
        const hasRange =
          inp.selectionStart !== inp.selectionEnd &&
          inp.selectionStart !== null;
        if (!hasRange) {
          e.preventDefault();
          void navigator.clipboard.writeText(inp.value);
          sfx.copied();
          return;
        }
        // else: a range is selected — let the browser copy just that.
      }

      // ⌘V into a focused step-label input while we have a copied
      // set: hijack the browser's default text paste and run the
      // cells-paste pipeline using the focused step as the anchor.
      if (
        editing &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "v" &&
        copyAvailableRef.current &&
        t.tagName === "INPUT" &&
        (t as HTMLInputElement).dataset.stepId
      ) {
        const anchorStepId = (t as HTMLInputElement).dataset.stepId!;
        e.preventDefault();
        (t as HTMLInputElement).blur();
        pasteCellsFromAnchor(anchorStepId);
        return;
      }

      if (editing) return;

      // G-prefix sequence (W=Week, G=Gantt, D=today's Day, J=jump to a date).
      // Timing uses the
      // event's own timeStamp (a monotonic reading) rather than Date.now() so
      // the handler stays free of impure calls; both reads/writes below use
      // the same clock.
      if (gPendingRef.current && e.timeStamp - gPendingRef.current < 1500) {
        const k = e.key.toLowerCase();
        if (k === "w") {
          e.preventDefault();
          requestWeekView();
          gPendingRef.current = null;
          return;
        }
        if (k === "g") {
          e.preventDefault();
          setView("gantt");
          gPendingRef.current = null;
          return;
        }
        if (k === "d") {
          e.preventDefault();
          requestDayView(toISODate(new Date()));
          gPendingRef.current = null;
          return;
        }
        if (k === "j") {
          e.preventDefault();
          setDateJumpOpen(true);
          gPendingRef.current = null;
          return;
        }
        gPendingRef.current = null;
      }
      if (
        e.key.toLowerCase() === "g" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        gPendingRef.current = e.timeStamp;
        return;
      }

      // Chip mode toggles
      if (e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault();
        setChipModeByBlock((prev) => {
          const next = { ...prev };
          for (const b of blocks) next[b.id] = "T";
          return next;
        });
        return;
      }
      if (e.shiftKey && (e.key === "E" || e.key === "e")) {
        e.preventDefault();
        setChipModeByBlock((prev) => {
          const next = { ...prev };
          for (const b of blocks) next[b.id] = "E";
          return next;
        });
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // ⌘K is the universal "search everything" shortcut. The date
        // jumper still has the search-icon button in the date strip.
        e.preventDefault();
        requestSearch();
        return;
      }

      // Spreadsheet-style copy/paste on the selected step cells. Only
      // fires when there's a cells selection and the user isn't typing
      // inside a label/effort input (browser-native copy/paste still
      // works there). Format: rows = "\n"-separated, cols = "\t"-
      // separated (label, effort minutes). One column = labels only.
      // Pattern repeats if clipboard < selection count.
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "c" &&
        selection?.kind === "cells"
      ) {
        e.preventDefault();
        runCellsCopy(selection);
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "v" &&
        selection?.kind === "cells"
      ) {
        e.preventDefault();
        const sel = selection;
        const stepsById = new Map(steps.map((s) => [s.id, s]));
        const selectedSteps = Array.from(sel.stepIds)
          .map((id) => stepsById.get(id))
          .filter((s): s is Step => !!s)
          .sort((a, b) => a.day_offset - b.day_offset);
        if (selectedSteps.length === 0) return;
        void (async () => {
          let text = "";
          try {
            text = await navigator.clipboard.readText();
          } catch {
            return;
          }
          if (!text) return;
          // Preserve empty cells (don't filter empty lines — they're a
          // valid "clear this label" instruction).
          const rows = text.replace(/\r\n/g, "\n").split("\n");
          // Trim trailing blank row that Excel-style copies often add.
          while (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
          if (rows.length === 0) return;
          // Single-cell paste = anchor expansion: paste rows starting
          // at the selected cell rather than cramming N rows into 1.
          // Multi-cell paste keeps the cycle-through behavior so a
          // short clipboard fills the whole selection.
          if (selectedSteps.length === 1 && rows.length > 1) {
            pasteCellsFromAnchor(selectedSteps[0].id);
            return;
          }
          recordSnapshot();
          sfx.pasted();
          selectedSteps.forEach((s, i) => {
            const row = rows[i % rows.length];
            const cols = row.split("\t");
            const label = cols[0];
            const patch: Partial<Step> = { label };
            if (cols.length > 1) {
              const n = parseInt(cols[1], 10);
              if (!isNaN(n) && n >= 0 && n <= 1440) {
                patch.duration_min = n;
              } else if (cols[1].trim() === "") {
                patch.duration_min = null;
              }
            }
            onUpdateStep(s.id, patch);
          });
          setCopiedStepIds(new Set());
          copyAvailableRef.current = false;
        })();
        return;
      }
      // Same spreadsheet model for *items* (the task rows themselves).
      // Copy joins selected item titles with newlines; paste rewrites
      // titles cycling through clipboard rows when the selection is
      // longer than the clipboard. Stays out of the way when the user
      // is typing — the early bail for inputs above already handles
      // that — so cell- and item-level copy/paste both feel native.
      // Items selection: each row in the clipboard holds the item
      // title followed by its step labels tab-separated, so a row reads
      // like one spreadsheet record. Pasting maps title → item.title
      // and the remaining columns → step labels in day_offset order
      // (cycling if the row is shorter than the item's step count, so
      // pasting a single label fills every step the way Excel does).
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "c" &&
        selection?.kind === "items"
      ) {
        e.preventDefault();
        const itemsById = new Map(items.map((i) => [i.id, i]));
        const selectedItems = Array.from(selection.itemIds)
          .map((id) => itemsById.get(id))
          .filter((i): i is Item => !!i)
          .sort(
            (a, b) =>
              (a.block_id ?? "").localeCompare(b.block_id ?? "") ||
              a.start_date.localeCompare(b.start_date),
          );
        const text = selectedItems
          .map((it) => {
            const itemSteps = (stepsByItem.get(it.id) ?? [])
              .slice()
              .sort((a, b) => a.day_offset - b.day_offset);
            const cols = [it.title, ...itemSteps.map((s) => s.label)];
            return cols.join("\t");
          })
          .join("\n");
        void navigator.clipboard.writeText(text);
        sfx.copied();
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "v" &&
        selection?.kind === "items"
      ) {
        e.preventDefault();
        const sel = selection;
        const itemsById = new Map(items.map((i) => [i.id, i]));
        const selectedItemIds = Array.from(sel.itemIds)
          .map((id) => itemsById.get(id))
          .filter((i): i is Item => !!i)
          .sort(
            (a, b) =>
              (a.block_id ?? "").localeCompare(b.block_id ?? "") ||
              a.start_date.localeCompare(b.start_date),
          )
          .map((i) => i.id);
        if (selectedItemIds.length === 0) return;
        void (async () => {
          let text = "";
          try {
            text = await navigator.clipboard.readText();
          } catch {
            return;
          }
          if (!text) return;
          const rows = text.replace(/\r\n/g, "\n").split("\n");
          while (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
          if (rows.length === 0) return;
          recordSnapshot();
          sfx.pasted();
          selectedItemIds.forEach((itemId, i) => {
            const cols = rows[i % rows.length].split("\t");
            const title = cols[0];
            onUpdateItem(itemId, { title });
            const stepLabels = cols.slice(1);
            if (stepLabels.length === 0) return;
            const itemSteps = (stepsByItem.get(itemId) ?? [])
              .slice()
              .sort((a, b) => a.day_offset - b.day_offset);
            itemSteps.forEach((s, idx) => {
              const label = stepLabels[idx % stepLabels.length];
              if (label !== undefined && label !== s.label) {
                onUpdateStep(s.id, { label });
              }
            });
          });
        })();
        return;
      }
      // Cmd/Ctrl+Z → undo. Cmd/Ctrl+Shift+Z → redo. We bail above for
      // inputs/textareas so the browser's own text-undo still works
      // while typing in a step label.
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "z" &&
        !e.altKey
      ) {
        e.preventDefault();
        if (e.shiftKey) {
          if (undoApi.canRedo()) sfx.redo();
          void undoApi.redo();
        } else {
          if (undoApi.canUndo()) sfx.undo();
          void undoApi.undo();
        }
        return;
      }
      // Plain `c` opens the New-item modal.
      //
      // ⚠️ The modifier guard is the point. The ⌘C / ⌘V branches above are
      // entered only when there is a cell or item selection, so ⌘C with
      // NOTHING selected used to fall through to here — and pressing "copy" on
      // an empty board opened a create-task dialog, which is about the least
      // expected thing that keystroke could do. MEASURED: ⌘X, ⌘V, ⌘T and ⌘N
      // were all already correct; `c` was the only unguarded letter.
      if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setItemModal({});
        return;
      }

      // Week view: ← / → move one week. Handled before cell-nav so it wins.
      if (view === "week") {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          goPrevWeek();
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          goNextWeek();
          return;
        }
      }

      // Cell-selection nav
      if (selection) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          shiftSelection(-1);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          shiftSelection(1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveSelectionCursor(-1);
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveSelectionCursor(1);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          clearSelection();
          return;
        }
      }

      // Esc dismisses the marching-ants visual even when there's no
      // active painted selection (so Cmd+C → Esc works the way Excel
      // does). Doesn't touch copyAvailableRef — the OS clipboard
      // still holds the rows, so ⌘V elsewhere still pastes them.
      if (e.key === "Escape" && copiedStepIds.size > 0) {
        e.preventDefault();
        setCopiedStepIds(new Set());
        return;
      }

      // Backspace / Delete on a cells selection clears every selected
      // step's label (and effort) — Excel "clear contents" gesture.
      // Editing check above already bailed when an input is focused,
      // so this only fires from the body / row-overlay context.
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selection?.kind === "cells" &&
        selection.stepIds.size > 0
      ) {
        e.preventDefault();
        recordSnapshot();
        for (const sid of selection.stepIds) {
          onUpdateStep(sid, { label: "" });
        }
        return;
      }
      // Esc exits day-focus mode (when nothing else has consumed it).
      if (e.key === "Escape" && focusedDayISO) {
        e.preventDefault();
        setFocusedDayISO(null);
        return;
      }

      if (e.key === "1") setView("gantt");
      if (e.key === "2") requestWeekView();
      if (e.key === "3") requestDayView(dayViewDate ?? toISODate(new Date()));
      if (
        e.key.toLowerCase() === "t" &&
        !e.shiftKey &&
        scrollRef.current &&
        todayIndex >= 0
      ) {
        scrollRef.current.scrollTo({
          left: Math.max(0, todayIndex * colW - 80),
          behavior: "smooth",
        });
      }
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Active items by block. Done steps are excluded inside ItemSection,
  // and items with zero remaining undone steps are filtered out here.
  // When focused on a day, only items with a step on that date are kept.
  const itemsByBlock = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const b of blocks) m.set(b.id, []);
    for (const it of items) {
      const itSteps = stepsByItem.get(it.id) ?? [];
      const allDone =
        itSteps.length > 0 && itSteps.every((s) => s.status === "done");
      // System blocks are hidden from the lane map: the Completed block
      // renders its own flat list inside CompletedSection and must not also
      // appear as a lane.
      const block = blocks.find((b) => b.id === it.block_id);
      if (block?.is_system) continue;
      if (allDone) continue;
      // Recurring series live on the calendar; the Gantt hides their rows
      // unless the user opts in via settings.
      if (it.recurrence && !settings.showRecurringOnGantt) continue;
      // Focus-mode filter: keep only items with a step landing on this day.
      if (focusedDayISO) {
        const hasFocusStep = itSteps.some(
          (s) =>
            s.status !== "done" &&
            isoAtOffset(it.start_date, s.day_offset) === focusedDayISO,
        );
        if (!hasFocusStep) continue;
      }
      if (it.block_id) m.get(it.block_id)?.push(it);
    }
    for (const arr of m.values())
      arr.sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.start_date.localeCompare(b.start_date),
      );
    return m;
  }, [blocks, items, stepsByItem, focusedDayISO, settings.showRecurringOnGantt]);

  /**
   * Steps to render per item. In normal mode this is the full step list;
   * in focus mode it's restricted to the step(s) whose computed date is
   * the focused day. Drives BlockSection's per-item rendering so StepRow,
   * deadline cells, etc. all stay in sync.
   */
  const visibleStepsByItem = useMemo(() => {
    if (!focusedDayISO) return stepsByItem;
    const m = new Map<string, Step[]>();
    for (const [id, arr] of stepsByItem.entries()) {
      const it = items.find((x) => x.id === id);
      if (!it) {
        m.set(id, arr);
        continue;
      }
      m.set(
        id,
        arr.filter(
          (s) => isoAtOffset(it.start_date, s.day_offset) === focusedDayISO,
        ),
      );
    }
    return m;
  }, [stepsByItem, items, focusedDayISO]);

  // Completed step list (flat) — across all items, with no history window.
  const completedStepEntries = useMemo(() => {
    const entries: Array<{ step: Step; item: Item; block: Block | undefined }> =
      [];
    for (const s of steps) {
      if (s.status !== "done") continue;
      const item = items.find((i) => i.id === s.item_id);
      if (!item) continue;
      const block = blocks.find((b) => b.id === item.block_id);
      entries.push({ step: s, item, block });
    }
    entries.sort((a, b) =>
      (b.step.completed_at ?? "").localeCompare(a.step.completed_at ?? ""),
    );
    return entries;
  }, [steps, items, blocks]);

  // Three-layer ordering:
  //   1. active, non-system user blocks (the normal editable lanes)
  //   2. system blocks (the Completed section)
  //   3. archived blocks (rendered read-only at the bottom)
  // Archived blocks are preserved data shown dimmed + locked, never deleted.
  const orderedBlocks = useMemo(() => {
    const activeUser = blocks
      .filter((b) => !b.is_system && !b.archived)
      .sort((a, b) => a.sort_order - b.sort_order);
    // Sorted, unlike before: with two system blocks the order stopped being
    // incidental. Calendar (9998) sits above Completed (9999).
    const systemBlocks = blocks
      .filter((b) => b.is_system)
      .sort((a, b) => a.sort_order - b.sort_order);
    const archivedUser = blocks
      .filter((b) => !b.is_system && b.archived)
      .sort((a, b) => a.sort_order - b.sort_order);
    return [...activeUser, ...systemBlocks, ...archivedUser];
  }, [blocks]);

  // ─── Mutations ─────────────────────────────────────────────────────────
  /**
   * Rename the active board (inline edit in the TopBar). Trims the input and
   * falls back to "Untitled Board" when blank so the board never persists an
   * empty name. Optimistic: the local `boardName` updates immediately; on a
   * server rejection we roll back to the prior value. No-ops when unchanged.
   */
  const onRenameBoard = useCallback(
    (raw: string) => {
      const next = raw.trim() || "Untitled Board";
      setBoardName((prev) => {
        if (next === prev) return prev;
        persist(async () => {
          try {
            await updateBoard(activeBoardId, { name: next });
          } catch (e) {
            // Server rejected — restore the previous name so the UI stays truthful.
            setBoardName(prev);
            console.error("[board] rename failed", e);
          }
        });
        return next;
      });
    },
    [activeBoardId, persist],
  );

  const onCreateBlock = useCallback(
    (input: { name: string; color: string; icon: string | null }) => {
      recordSnapshot();
      sfx.taskCreated();
      const sort = Math.max(0, ...blocks.map((b) => b.sort_order)) + 1;
      // Client-generated id so the optimistic row shares its key with the
      // persisted row, and the server echo updates it in place instead of
      // appending a phantom duplicate.
      const blockId = crypto.randomUUID();
      const optim: Block = {
        id: blockId,
        board_id: activeBoardId,
        name: input.name,
        color: input.color,
        sort_order: sort,
        collapsed: false,
        is_system: false,
        archived: false,
        icon: input.icon,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setBlocks((p) => [...p, optim]);
      setBlockModal(null);
      persist(
        async () => {
          try {
            const real = await createBlock({
              ...input,
              id: blockId,
              board_id: activeBoardId,
              sort_order: sort,
            });
            // `real` is undefined only if the action threw and was sanitized;
            // the catch handles that, so this guard is for the type system.
            if (real) {
              setBlocks((p) => p.map((b) => (b.id === blockId ? real : b)));
            }
          } catch (e) {
            setBlocks((p) => p.filter((b) => b.id !== blockId));
            console.error("[block] create failed", e);
          }
        },
        { keys: ["blocks:" + blockId] },
      );
    },
    [blocks, activeBoardId],
  );

  const onEditBlock = useCallback(
    (id: string, patch: { name?: string; color?: string; icon?: string | null }) => {
      recordSnapshot();
      setBlocks((p) => p.map((b) => (b.id === id ? { ...b, ...patch } : b)));
      setBlockModal(null);
      persist(() => updateBlock(id, patch), { keys: ["blocks:" + id] });
    },
    [recordSnapshot],
  );

  /** Lightweight inline update for non-modal block edits (icon picker, etc). */
  const onUpdateBlock = useCallback(
    (id: string, patch: { icon?: string | null; color?: string }) => {
      setBlocks((p) => p.map((b) => (b.id === id ? { ...b, ...patch } : b)));
      persist(() => updateBlock(id, patch), { keys: ["blocks:" + id] });
    },
    [],
  );

  /**
   * Archive a block — preserves it read-only via the
   * existing `updateBlock(id, { archived: true })` path. Optimistic, with an
   * undo snapshot so the whole archive is reversible.
   */
  const onArchiveBlock = useCallback(
    (id: string) => {
      recordSnapshot();
      sfx.archived();
      setBlocks((p) =>
        p.map((b) => (b.id === id ? { ...b, archived: true } : b)),
      );
      persist(() => updateBlock(id, { archived: true }), {
        keys: ["blocks:" + id],
      });
    },
    [recordSnapshot],
  );

  /**
   * Un-archive a block (bring it back to active). Optimistic, with a rollback
   * if the write rejects.
   */
  const onActivateBlock = useCallback(
    (id: string) => {
      recordSnapshot();
      sfx.restored();
      setBlocks((p) =>
        p.map((b) => (b.id === id ? { ...b, archived: false } : b)),
      );
      persist(async () => {
        try {
          await updateBlock(id, { archived: false });
        } catch (e) {
          setBlocks((p) =>
            p.map((b) => (b.id === id ? { ...b, archived: true } : b)),
          );
          console.error("[block] activate failed", e);
        }
      });
    },
    [recordSnapshot],
  );

  const onDeleteBlock = useCallback(
    async (block: Block) => {
      if (block.is_system) {
        await dialogs.confirm({
          title: `Can't delete "${block.name}"`,
          message: "This is a system block.",
          confirmLabel: "OK",
          cancelLabel: "",
        });
        return;
      }
      const ok = await dialogs.confirm({
        title: `Delete "${block.name}"?`,
        message: "All items and steps inside this block will be deleted.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      recordSnapshot();
      sfx.deleted();
      const droppedItemIds = new Set(
        items.filter((i) => i.block_id === block.id).map((i) => i.id),
      );
      setBlocks((p) => p.filter((b) => b.id !== block.id));
      setItems((p) => p.filter((i) => i.block_id !== block.id));
      setSteps((p) => p.filter((s) => !droppedItemIds.has(s.item_id)));
      persist(() => deleteBlock(block.id), { keys: ["blocks:" + block.id] });
    },
    [dialogs, items],
  );

  const onToggleBlock = useCallback((b: Block) => {
    const next = !b.collapsed;
    (next ? sfx.dropdownClose : sfx.dropdownOpen)();
    setBlocks((p) =>
      p.map((x) => (x.id === b.id ? { ...x, collapsed: next } : x)),
    );
    persist(() => updateBlock(b.id, { collapsed: next }), {
      keys: ["blocks:" + b.id],
    });
  }, []);

  const onSetChipMode = useCallback((blockId: string, mode: ChipMode) => {
    setChipModeByBlock((p) => ({ ...p, [blockId]: mode }));
  }, []);

  const onToggleItemCollapsed = useCallback((itemId: string) => {
    setCollapsedItems((p) => {
      const n = new Set(p);
      if (n.has(itemId)) {
        n.delete(itemId);
        sfx.dropdownOpen();
      } else {
        n.add(itemId);
        sfx.dropdownClose();
      }
      return n;
    });
  }, []);

  const onCreateItem = useCallback(
    (input: {
      title: string;
      blockId: string;
      startDate: string;
      durationDays: number;
    }) => {
      recordSnapshot();
      setItemModal(null);
      sfx.taskCreated();
      setLastBlockId(input.blockId);
      // Creating a task into a collapsed block would hide the new item. Expand
      // the block (optimistic + server) so the user sees what they just made.
      // Read collapse state inside the updater to avoid a stale closure — this
      // callback has empty deps.
      let wasCollapsed = false;
      setBlocks((p) =>
        p.map((b) => {
          if (b.id === input.blockId && b.collapsed) {
            wasCollapsed = true;
            return { ...b, collapsed: false };
          }
          return b;
        }),
      );
      if (wasCollapsed) {
        persist(() => updateBlock(input.blockId, { collapsed: false }), {
          keys: ["blocks:" + input.blockId],
        });
      }
      // Generate UUIDs up-front so optimistic rows share keys with persisted
      // rows. No remount/animation replay when the server echoes back.
      const itemId = crypto.randomUUID();
      const stepIds = Array.from({ length: input.durationDays }, () =>
        crypto.randomUUID(),
      );
      const optim: Item = {
        id: itemId,
        board_id: activeBoardId,
        block_id: input.blockId,
        prev_block_id: null,
        title: input.title,
        start_date: input.startDate,
        duration_days: input.durationDays,
        deadline_offset: input.durationDays,
        color: null,
        deadline_id: null,
        recurrence: null,
        sort_order: Date.now(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const optimSteps: Step[] = stepIds.map((id, i) => ({
        id,
        board_id: activeBoardId,
        // Not a rule occurrence — no origin.
        origin_day_offset: null,
        item_id: itemId,
        day_offset: i,
        label: "",
        time_of_day: null,
        duration_min: null,
        detached: false,
        notes: null,
        status: "todo" as const,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      setItems((p) => [...p, optim]);
      setSteps((p) => [...p, ...optimSteps]);
      setFreshlyCreatedId(itemId);
      // Clear roughly after the cascade finishes (matches step variants above).
      setTimeout(
        () => setFreshlyCreatedId((cur) => (cur === itemId ? null : cur)),
        input.durationDays * 40 + 400,
      );

      persist(
        async () => {
          await createItemWithSteps({
            id: itemId,
            stepIds,
            title: input.title,
            block_id: input.blockId,
            board_id: activeBoardId,
            start_date: input.startDate,
            duration_days: input.durationDays,
          });
        },
        {
          keys: [
            "items:" + itemId,
            ...stepIds.map((id) => "steps:" + id),
          ],
        },
      );
    },
    [activeBoardId],
  );

  // Create a calendar event from a drag on the week/day grid. blockId null =
  // calendar-only (renders in the calendar, hidden from the Gantt). A blocked
  // task shows on the Gantt collapsed by default so it stays tidy.
  // With recurringDays set, this creates a SERIES instead: one item carrying
  // the rule, with an occurrence step on every matching weekday out to the
  // rolling materialization horizon.
  const onCreateCalendarTask = useCallback(
    (input: {
      date: string;
      time: string;
      durationMin: number;
      blockId: string | null;
      title: string;
      recurringDays: number[] | null;
    }) => {
      const recurring = !!input.recurringDays?.length;
      recordSnapshot();
      sfx.taskCreated();
      const itemId = crypto.randomUUID();
      const title = input.title || "Untitled";
      const rule: Recurrence | null = recurring
        ? {
            days: input.recurringDays!,
            time: input.time,
            durationMin: input.durationMin,
          }
        : null;
      // One-off events keep a single step at offset 0; a series gets one
      // step per occurrence. (Offset 0 is only present if the dragged
      // weekday stayed selected in the picker.)
      const offsets = rule
        ? occurrenceOffsets(input.date, rule, 0, MATERIALIZE_AHEAD_DAYS)
        : [0];
      if (offsets.length === 0) return; // no matching day — nothing to make
      const stepIds = offsets.map(() => crypto.randomUUID());
      const duration = offsets[offsets.length - 1] + 1;
      const nowISO = new Date().toISOString();
      const optimItem: Item = {
        id: itemId,
        board_id: activeBoardId,
        block_id: input.blockId,
        prev_block_id: null,
        title,
        start_date: input.date,
        duration_days: duration,
        deadline_offset: duration,
        color: null,
        deadline_id: null,
        recurrence: rule,
        sort_order: Date.now(),
        created_at: nowISO,
        updated_at: nowISO,
      };
      const optimSteps: Step[] = offsets.map((day_offset, i) => ({
        id: stepIds[i],
        board_id: activeBoardId,
        item_id: itemId,
        day_offset,
        // The typed name doubles as the step label so calendar cards render
        // it — EXCEPT for series, which keep labels empty so the item title
        // is the single rename surface for every occurrence.
        label: rule ? "" : title,
        time_of_day: input.time,
        duration_min: input.durationMin,
        // Only a series has a rule to have an origin against.
        origin_day_offset: rule ? day_offset : null,
        detached: false,
        notes: null,
        status: "todo" as const,
        completed_at: null,
        created_at: nowISO,
        updated_at: nowISO,
      }));
      setItems((p) => [...p, optimItem]);
      setSteps((p) => [...p, ...optimSteps]);
      // Blocked calendar task → collapsed on the Gantt by default.
      if (input.blockId) {
        setCollapsedItems((prev) => new Set(prev).add(itemId));
      }
      persist(async () => {
        // Atomic: steps are created WITH their time + duration so they never
        // flicker as untimed/TBD cards before a follow-up update.
        await createItemWithSteps({
          id: itemId,
          stepIds,
          title,
          block_id: input.blockId,
          board_id: activeBoardId,
          start_date: input.date,
          duration_days: duration,
          stepTime: input.time,
          stepDurationMin: input.durationMin,
          ...(rule
            ? { recurrence: rule, stepOffsets: offsets }
            : { stepLabel: title }),
        });
      });
    },
    [activeBoardId],
  );

  /**
   * Confirm a body-drag that's about to shift a task whose deadline rides with
   * it. Always shown, except while the user has dismissed it "for today".
   * Returns true if the move should proceed.
   */
  const confirmShiftDeadline = useCallback(async (): Promise<boolean> => {
    const today = toISODate(new Date());
    if (settings.suppressShiftDeadlineWarningDate === today) return true;
    const r = await dialogs.confirmEx({
      title: "Moving this task will shift its deadline",
      message:
        "The deadline is anchored to the task's start, so dragging the bar moves both. Proceed?",
      confirmLabel: "Move",
      cancelLabel: "Cancel",
      dontAskAgainLabel: "Don't show again for today",
    });
    if (r.dontAskAgain) {
      void updateSettings({ suppressShiftDeadlineWarningDate: today });
    }
    return r.ok;
  }, [dialogs, settings.suppressShiftDeadlineWarningDate]);

  const onUpdateItem = useCallback(
    (id: string, patch: Partial<Item>) => {
      recordSnapshot();
      setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
      persist(() => updateItem(id, patch), { keys: ["items:" + id] });
    },
    [recordSnapshot, persist],
  );

  /**
   * Translate every item currently in the items-selection by the same day
   * delta. Called when the user drags one selected item bar — all selected
   * items move together.
   */
  const onMultiBodyShift = useCallback(
    (dDays: number) => {
      if (!selection || selection.kind !== "items" || dDays === 0) return;
      const ids = Array.from(selection.itemIds);
      // Compute the new start_dates from current items, then patch state +
      // server in one pass to keep the move visually atomic. Moving back
      // (earlier) keeps each deadline fixed (compensate its offset); moving
      // forward lets the deadline ride along.
      const patches: {
        id: string;
        newStart: string;
        newDeadlineOffset?: number;
      }[] = [];
      for (const id of ids) {
        const it = items.find((x) => x.id === id);
        if (!it) continue;
        const patch = { id, newStart: isoAtOffset(it.start_date, dDays) } as {
          id: string;
          newStart: string;
          newDeadlineOffset?: number;
        };
        if (dDays < 0) {
          const undone = (stepsByItem.get(id) ?? []).filter(
            (s) => s.status !== "done",
          );
          const e = effectiveDeadlineOffset(
            it.deadline_offset,
            undone.map((s) => s.day_offset),
          );
          patch.newDeadlineOffset = Math.min(3650, e - dDays);
        }
        patches.push(patch);
      }
      if (patches.length === 0) return;
      recordSnapshot();
      const byId = new Map(patches.map((p) => [p.id, p]));
      setItems((prev) =>
        prev.map((i) => {
          const p = byId.get(i.id);
          if (!p) return i;
          return {
            ...i,
            start_date: p.newStart,
            ...(p.newDeadlineOffset !== undefined
              ? { deadline_offset: p.newDeadlineOffset }
              : {}),
          };
        }),
      );
      persist(
        async () => {
          await Promise.all(
            patches.map((p) =>
              updateItem(p.id, {
                start_date: p.newStart,
                ...(p.newDeadlineOffset !== undefined
                  ? { deadline_offset: p.newDeadlineOffset }
                  : {}),
              }),
            ),
          );
        },
        { keys: patches.map((p) => "items:" + p.id) },
      );
    },
    [selection, items, stepsByItem, recordSnapshot],
  );

  /**
   * Left-edge resize while the deadline stays fixed. Pulling the edge back
   * (earlier) re-spreads the cells into the staircase — adding new TBD cells
   * once it's full; pushing the edge in (later) stacks them toward the deadline.
   * Repositions existing steps via `applyItemMove`, then creates any new ones
   * with `addStepAt`.
   */
  const applyLeftPull = useCallback(
    (itemId: string, dStart: number) => {
      if (dStart === 0) return;
      const item = items.find((x) => x.id === itemId);
      if (!item) return;
      const undone = (stepsByItem.get(itemId) ?? []).filter(
        (s) => s.status !== "done",
      );
      let r: LeftPullResult;
      if (dStart < 0) {
        // Pull back (earlier): re-spread / unstack into the staircase, adding
        // new TBD cells once it's full.
        r = computeLeftPull(item, undone, dStart);
      } else {
        // Push in (later): stack the cells toward the deadline (reuse the
        // pile-at-start math). Clamp so the start can't reach/pass the deadline.
        const offsets = undone.map((s) => s.day_offset);
        const e = effectiveDeadlineOffset(item.deadline_offset, offsets);
        const eff = Math.min(dStart, Math.max(0, e - 1));
        if (eff === 0) return;
        const b = computeBodyDrag(item, undone, eff);
        r = {
          stepUpdates: b.stepUpdates,
          addOffsets: [],
          newStartDate: b.newStartDate,
          newDeadlineOffset: b.newDeadlineOffset,
          newDuration: b.newDuration,
          noop: b.noop,
        };
      }
      if (r.noop) return;

      recordSnapshot();

      // Optimistic: reposition existing cells into the staircase.
      if (r.stepUpdates.length) {
        const byId = new Map(r.stepUpdates.map((u) => [u.id, u.day_offset]));
        setSteps((p) =>
          p.map((s) =>
            byId.has(s.id) ? { ...s, day_offset: byId.get(s.id)! } : s,
          ),
        );
      }

      // Optimistic: add new TBD cells with client UUIDs (swapped for real on persist).
      const nowStamp = Date.now();
      const tmp = r.addOffsets.map((offset) => ({
        stepId: crypto.randomUUID(),
        offset,
      }));
      if (tmp.length) {
        const nowISO = new Date(nowStamp).toISOString();
        setSteps((p) => [
          ...p,
          ...tmp.map((t) => ({
            id: t.stepId,
            item_id: itemId,
            board_id: item.board_id,
            day_offset: t.offset,
            // Not a rule occurrence — no origin.
            origin_day_offset: null,
            label: "",
            detached: false,
            notes: null,
            status: "todo" as const,
            time_of_day: null,
            duration_min: null,
            completed_at: null,
            created_at: nowISO,
            updated_at: nowISO,
          })),
        ]);
      }

      // Optimistic: item fields (start earlier, deadline frozen, grow duration).
      setItems((p) =>
        p.map((i) =>
          i.id === itemId
            ? {
                ...i,
                ...(r.newStartDate !== undefined
                  ? { start_date: r.newStartDate }
                  : {}),
                ...(r.newDeadlineOffset !== undefined
                  ? { deadline_offset: r.newDeadlineOffset }
                  : {}),
                ...(r.newDuration !== undefined
                  ? { duration_days: r.newDuration }
                  : {}),
              }
            : i,
        ),
      );

      persist(
        async () => {
          await applyItemMove({
            itemId,
            stepUpdates: r.stepUpdates,
            newStartDate: r.newStartDate,
            newDuration: r.newDuration,
            newDeadlineOffset: r.newDeadlineOffset,
            // 0 = the rule did not change. A fact about a resize, not a fallback.
            ruleDelta: 0,
          });
          for (const t of tmp) {
            const real = await addStepAt(itemId, t.offset, t.stepId);
            if (real)
              setSteps((p) => p.map((s) => (s.id === t.stepId ? real : s)));
          }
        },
        {
          keys: [
            "items:" + itemId,
            ...r.stepUpdates.map((u) => "steps:" + u.id),
            ...tmp.map((t) => "steps:" + t.stepId),
          ],
        },
      );
    },
    [items, stepsByItem, recordSnapshot, persist],
  );

  const onResizeItem = useCallback(
    async (
      item: Item,
      newDuration: number,
      opts?: { alsoSetStartDate?: string },
    ) => {
      if (newDuration === item.duration_days && !opts?.alsoSetStartDate) return;
      if (newDuration < 1) return;
      // Shrink confirm fires for ANY shrink (not just label-dropping).
      // Earlier "only warn if dropping labeled steps" meant a quick
      // right-edge drag silently destroyed empty days — which the user
      // never asked to do. Cancel early-returns so neither the bar
      // width nor the start_date changes.
      if (newDuration < item.duration_days && !settings.suppressShrinkWarning) {
        const droppedCount = item.duration_days - newDuration;
        const droppedLabeled = (stepsByItem.get(item.id) ?? []).filter(
          (s) => s.day_offset >= newDuration && s.label.trim() !== "",
        );
        const labelNote = droppedLabeled.length
          ? `, including ${droppedLabeled.length} labeled step${droppedLabeled.length === 1 ? "" : "s"}`
          : "";
        const r = await dialogs.confirmEx({
          title: `Shrink "${item.title}" to ${newDuration} day${newDuration === 1 ? "" : "s"}?`,
          message: `${droppedCount} day${droppedCount === 1 ? "" : "s"} will be removed${labelNote}.`,
          confirmLabel: "Shrink",
          destructive: droppedLabeled.length > 0,
          dontAskAgainLabel: "Don't ask again",
        });
        if (!r.ok) return;
        if (r.dontAskAgain) {
          void updateSettings({ suppressShrinkWarning: true });
        }
      }
      recordSnapshot();
      setItems((p) =>
        p.map((i) =>
          i.id === item.id
            ? {
                ...i,
                duration_days: newDuration,
                ...(opts?.alsoSetStartDate
                  ? { start_date: opts.alsoSetStartDate }
                  : null),
              }
            : i,
        ),
      );
      // Optimistic step rebuild — without this, the visible bar width
      // doesn't change until the server roundtrip completes, since the
      // bar's right edge is anchored to max(step.day_offset), not to
      // item.duration_days. Use max(offset)+1 as the baseline (same as
      // the server) so gappy items don't double-add or collide.
      setSteps((p) => {
        const others = p.filter((s) => s.item_id !== item.id);
        const current = p.filter((s) => s.item_id === item.id);
        const maxOffset = current.length
          ? Math.max(...current.map((s) => s.day_offset))
          : -1;
        const currentSlots = maxOffset + 1;
        if (newDuration < currentSlots) {
          return [
            ...others,
            ...current.filter((s) => s.day_offset < newDuration),
          ];
        }
        if (newDuration > currentSlots) {
          const addCount = newDuration - currentSlots;
          const nowISO = new Date().toISOString();
          const added: Step[] = Array.from({ length: addCount }, (_, i) => ({
            id: `tmp_step_${item.id}_${currentSlots + i}`,
            board_id: item.board_id,
            // Not a rule occurrence — no origin.
            origin_day_offset: null,
            item_id: item.id,
            day_offset: currentSlots + i,
            label: "",
            detached: false,
            time_of_day: null,
            duration_min: null,
            notes: null,
            status: "todo",
            completed_at: null,
            created_at: nowISO,
            updated_at: nowISO,
          }));
          return [...others, ...current, ...added];
        }
        return p;
      });
      persist(
        async () => {
          const newSteps = await resizeItem(item.id, newDuration);
          setSteps((p) => [
            ...p.filter((s) => s.item_id !== item.id),
            ...newSteps,
          ]);
        },
        { keys: ["items:" + item.id] },
      );
    },
    [dialogs, stepsByItem, recordSnapshot, settings.suppressShrinkWarning],
  );

  /**
   * Append one new step to an item. Single source of truth for the "+ Add a
   * day" button (in the item header) and the right-click "Add a day" menu
   * option.
   *
   * Why a dedicated path instead of going through onResizeItem:
   *  - onResizeItem(target) hits the server's `resizeItem`, which inserts
   *    new steps at `day_offset: currentCount + i`. If existing offsets
   *    have gaps (after some deletes), that collides with existing rows.
   *  - The right-click menu was passing `item.duration_days + 1`, which
   *    drifts higher than the actual step count after some delete flows
   *    (duration_days is anchored on `max(offset)+1`, not on count).
   *    Result: one click added several phantom steps to "fill in" the gap.
   *  - The + button was using a filtered step list in day-focus mode and
   *    would shrink the item instead of growing it.
   *
   * This callback uses the FULL stepsByItem list and inserts at
   * `max(day_offset)+1`, so each click adds exactly one row at the
   * correct staircase position.
   */
  const onAddStep = useCallback(
    (item: Item) => {
      // Double-fire guard: ignore a second call within 350 ms for the same item.
      const now = Date.now();
      if (now - (addStepGuardRef.current.get(item.id) ?? 0) < 350) return;
      addStepGuardRef.current.set(item.id, now);
      recordSnapshot();
      sfx.stepAdded();
      const itemSteps = stepsByItem.get(item.id) ?? [];
      // Place the new step after the last UNDONE step, not the last step
      // overall — done steps may be clustered at the end and would otherwise
      // create a gap of invisible rows between the new step and the last TBD.
      const undoneSteps = itemSteps.filter((s) => s.status !== "done");
      const baseSteps = undoneSteps.length > 0 ? undoneSteps : itemSteps;
      const newOffset =
        baseSteps.length > 0
          ? Math.max(...baseSteps.map((s) => s.day_offset)) + 1
          : 0;
      // Only extend duration if the new step falls outside the current range.
      const newDuration = Math.max(item.duration_days, newOffset + 1);
      const stepId = crypto.randomUUID();
      const optim: Step = {
        id: stepId,
        board_id: activeBoardId,
        // Not a rule occurrence — no origin.
        origin_day_offset: null,
        item_id: item.id,
        day_offset: newOffset,
        label: "",
        detached: false,
        notes: null,
        status: "todo" as const,
        time_of_day: null,
        duration_min: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setSteps((p) => [...p, optim]);
      if (item.duration_days !== newDuration) {
        setItems((p) =>
          p.map((i) =>
            i.id === item.id ? { ...i, duration_days: newDuration } : i,
          ),
        );
      }
      persist(
        async () => {
          const real = await addStepAt(item.id, newOffset, stepId);
          if (real) {
            setSteps((p) => p.map((s) => (s.id === stepId ? real : s)));
          }
          if (item.duration_days !== newDuration) {
            await updateItem(item.id, { duration_days: newDuration });
          }
        },
        {
          keys: [
            "steps:" + stepId,
            ...(item.duration_days !== newDuration ? ["items:" + item.id] : []),
          ],
        },
      );
    },
    [stepsByItem, recordSnapshot, activeBoardId],
  );

  const onDeleteItem = useCallback(
    async (item: Item) => {
      const ok = await dialogs.confirm({
        title: `Delete "${item.title}"?`,
        message: "All step rows for this item will be deleted.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      recordSnapshot();
      sfx.deleted();
      setItems((p) => p.filter((i) => i.id !== item.id));
      setSteps((p) => p.filter((s) => s.item_id !== item.id));
      persist(() => deleteItem(item.id), { keys: ["items:" + item.id] });
    },
    [dialogs, recordSnapshot],
  );

  /**
   * Edit one step's fields. The single entry point for every step write that
   * is not a create, a delete or a swap.
   *
   * ⚠️ The write is UNGUARDED, and that is the design: this app has exactly one
   * writer — the window in front of you — so there is no version to compare
   * against and every rejection a guard could produce would be a false one.
   * Do not add an expected-version argument here, to `applyItemMove`, or to
   * `resizeItem`.
   */
  const onUpdateStep = useCallback(
    (id: string, patch: Partial<Step>) => {
      recordSnapshot();
      setSteps((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      persist(() => updateStep(id, patch), {
        keys: ["steps:" + id],
        coalesceKey:
          "stepfield:" + id + ":" + Object.keys(patch).sort().join(","),
      });
    },
    [recordSnapshot, persist],
  );

  /**
   * Repeat a task at another time on the SAME day: insert a sibling step at the
   * source's day_offset with a chosen time (inheriting its label + effort) so a
   * task can occur multiple times in one day. The within-day sort stacks it by
   * time, right under the existing cell.
   */
  const onRepeatStep = useCallback(
    (source: Step, time: string) => {
      recordSnapshot();
      sfx.stepAdded();
      const stepId = crypto.randomUUID();
      const optim: Step = {
        id: stepId,
        board_id: activeBoardId,
        // Not a rule occurrence — no origin.
        origin_day_offset: null,
        item_id: source.item_id,
        day_offset: source.day_offset,
        label: source.label,
        detached: false,
        notes: null,
        status: "todo" as const,
        time_of_day: time,
        duration_min: source.duration_min ?? null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setSteps((p) => [...p, optim]);
      persist(
        async () => {
          const real = await addStepAt(source.item_id, source.day_offset, stepId);
          if (!real) return;
          const patch: Partial<Step> = {
            time_of_day: time,
            label: source.label,
            duration_min: source.duration_min ?? null,
          };
          setSteps((p) =>
            p.map((s) => (s.id === stepId ? { ...real, ...patch } : s)),
          );
          // `addStepAt` cannot carry a time or a label, so the sibling is
          // created first and then given the source's shape.
          await updateStep(real.id, patch);
        },
        { keys: ["steps:" + stepId] },
      );
    },
    [recordSnapshot, activeBoardId],
  );

  /** Toggle done. If the trigger step is part of a multi-cell selection, apply to the whole selection. */
  const onToggleStepDone = useCallback(
    (step: Step) => {
      recordSnapshot();
      const inMultiCellSel =
        selection?.kind === "cells" &&
        selection.stepIds.has(step.id) &&
        selection.stepIds.size > 1;
      const targetIds = inMultiCellSel
        ? Array.from((selection as { stepIds: Set<string> }).stepIds)
        : [step.id];
      const next = step.status === "done" ? "todo" : "done";
      const completed_at = next === "done" ? new Date().toISOString() : null;
      if (next === "done") sfx.completed();
      const targetSet = new Set(targetIds);
      setSteps((p) =>
        p.map((s) =>
          targetSet.has(s.id) ? { ...s, status: next, completed_at } : s,
        ),
      );
      persist(
        async () => {
          await Promise.all(
            targetIds.map((id) =>
              updateStep(id, { status: next, completed_at }),
            ),
          );
        },
        { keys: targetIds.map((id) => "steps:" + id) },
      );
    },
    [selection, recordSnapshot],
  );

  const onSwapSteps = useCallback(
    (aId: string, bId: string) => {
      recordSnapshot();
      setSteps((p) => {
        const a = p.find((s) => s.id === aId);
        const b = p.find((s) => s.id === bId);
        if (!a || !b) return p;
        return p.map((s) => {
          if (s.id === aId) return { ...s, day_offset: b.day_offset };
          if (s.id === bId) return { ...s, day_offset: a.day_offset };
          return s;
        });
      });
      persist(() => swapSteps(aId, bId), {
        keys: ["steps:" + aId, "steps:" + bId],
      });
    },
    [recordSnapshot],
  );

  /** Delete step. Bulk if part of a multi-cell selection. Also syncs item.duration_days. */
  const onDeleteStep = useCallback(
    async (step: Step) => {
      const inMultiCellSel =
        selection?.kind === "cells" &&
        selection.stepIds.has(step.id) &&
        selection.stepIds.size > 1;
      const targetIds = inMultiCellSel
        ? Array.from((selection as { stepIds: Set<string> }).stepIds)
        : [step.id];
      const targetSet = new Set(targetIds);
      const targetSteps = steps.filter((s) => targetSet.has(s.id));
      const labeled = targetSteps.filter((s) => s.label.trim());
      if (labeled.length > 0) {
        const ok = await dialogs.confirm({
          title:
            targetIds.length > 1
              ? `Delete ${targetIds.length} steps?`
              : "Delete this step?",
          message:
            targetIds.length > 1
              ? `${labeled.length} of them have a label.`
              : step.label,
          confirmLabel: "Delete",
          destructive: true,
        });
        if (!ok) return;
      }

      recordSnapshot();
      sfx.deleted();

      // Optimistic: remove steps + sync each affected item's duration_days to
      // max(offset)+1. Compute the new durations *inside* the setSteps
      // updater so we read the post-delete state, not a stale closure — two
      // back-to-back deletes used to desync `duration_days` from step count.
      const affectedItemIds = new Set(targetSteps.map((s) => s.item_id));
      const itemDurationPatches = new Map<string, number>();
      setSteps((prevSteps) => {
        const remaining = prevSteps.filter((s) => !targetSet.has(s.id));
        for (const itemId of affectedItemIds) {
          const itemSteps = remaining.filter((s) => s.item_id === itemId);
          const newDur = itemSteps.length
            ? Math.max(...itemSteps.map((s) => s.day_offset)) + 1
            : 1;
          itemDurationPatches.set(itemId, newDur);
        }
        return remaining;
      });
      setItems((prevItems) =>
        prevItems.map((i) => {
          const next = itemDurationPatches.get(i.id);
          return next !== undefined && next !== i.duration_days
            ? { ...i, duration_days: next }
            : i;
        }),
      );
      clearSelection();

      persist(
        async () => {
          await Promise.all(targetIds.map((id) => deleteStep(id)));
          await Promise.all(
            Array.from(itemDurationPatches.entries()).map(([id, d]) =>
              updateItem(id, { duration_days: d }),
            ),
          );
        },
        {
          keys: [
            ...targetIds.map((id) => "steps:" + id),
            ...Array.from(affectedItemIds).map((id) => "items:" + id),
          ],
        },
      );
    },
    [selection, dialogs, clearSelection, recordSnapshot],
  );

  // ─── Recurring-series scoped edits (this / following / all) ───
  // Calendar move/resize/delete of an occurrence asks for scope EVERY time
  // (per spec). "This task" detaches the occurrence so series-wide edits
  // skip it from then on; the wider scopes rewrite the rule too, so future
  // materialization follows the change.
  const chooseRecurringScope = useCallback(
    async (opts: { verb: string; destructive?: boolean }) => {
      const v = await dialogs.choose({
        title: `${opts.verb} recurring task`,
        options: [
          { value: "one", label: "This task" },
          { value: "following", label: "This and following tasks" },
          { value: "all", label: "All tasks" },
        ],
        confirmLabel: opts.verb,
        destructive: opts.destructive,
      });
      return v as "one" | "following" | "all" | null;
    },
    [dialogs],
  );

  const onCalendarUpdateStep = useCallback(
    (id: string, patch: Partial<Step>) => {
      const step = steps.find((s) => s.id === id);
      const item = step ? itemsById.get(step.item_id) : undefined;
      const rule = item?.recurrence;
      const isMove =
        "time_of_day" in patch ||
        "day_offset" in patch ||
        "duration_min" in patch;
      if (!step || !item || !rule || !isMove) {
        // Dropping a card on a day BEFORE the item's start would need a
        // negative day_offset. The calendar used to clamp it to 0, silently
        // relocating the card to the item's first day instead of where it was
        // dropped — deterministic for calendar-created events, which live at
        // offset 0. Shift the item's start back instead (the same
        // auto-shift-start the gantt's arrow-left uses, atomically via
        // applyItemMove) and apply any time component as a normal step edit.
        if (
          step &&
          item &&
          !rule &&
          patch.day_offset !== undefined &&
          patch.day_offset < 0
        ) {
          const { day_offset: rawOffset, ...rest } = patch;
          if (Object.keys(rest).length > 0) {
            onUpdateStep(id, rest); // records the gesture's undo snapshot
          } else {
            recordSnapshot();
          }
          applyShiftRef.current(
            item.id,
            new Set([id]),
            false,
            rawOffset - step.day_offset,
          );
          return;
        }
        onUpdateStep(id, patch);
        return;
      }
      void (async () => {
        const scope = await chooseRecurringScope({ verb: "Edit" });
        if (!scope) return;
        if (scope === "one") {
          // Recurring occurrences never shift the series start — a drop
          // before it clamps to the first day, as before.
          onUpdateStep(id, {
            ...patch,
            ...(patch.day_offset !== undefined
              ? { day_offset: Math.max(0, patch.day_offset) }
              : {}),
            detached: true,
          });
          return;
        }
        recordSnapshot();
        const dayDelta =
          patch.day_offset != null ? patch.day_offset - step.day_offset : 0;
        // Skip detached occurrences (individually moved earlier) and any
        // occurrence a backward day-move would push before the series start.
        const targets = steps.filter(
          (s) =>
            s.item_id === item.id &&
            !s.detached &&
            (scope === "all" || s.day_offset >= step.day_offset) &&
            s.day_offset + dayDelta >= 0,
        );
        // Fold the edit into the rule: new time/effort, and a day-move
        // rotates the weekday pattern — future occurrences follow.
        const nextRule: Recurrence = {
          ...rule,
          ...(patch.time_of_day ? { time: patch.time_of_day } : {}),
          ...("duration_min" in patch
            ? { durationMin: patch.duration_min ?? null }
            : {}),
          ...(dayDelta !== 0
            ? { days: rule.days.map((d) => (((d + dayDelta) % 7) + 7) % 7) }
            : {}),
        };
        const stepPatch = (s: Step): Partial<Step> => ({
          ...("time_of_day" in patch
            ? { time_of_day: patch.time_of_day }
            : {}),
          ...("duration_min" in patch
            ? { duration_min: patch.duration_min }
            : {}),
          ...(dayDelta !== 0 ? { day_offset: s.day_offset + dayDelta } : {}),
        });
        const targetIds = new Set(targets.map((s) => s.id));
        // Forward day-moves can push the last occurrence past the current
        // duration — keep duration covering the furthest step.
        const postOffsets = steps
          .filter((s) => s.item_id === item.id)
          .map((s) =>
            targetIds.has(s.id) ? s.day_offset + dayDelta : s.day_offset,
          );
        const newDur = postOffsets.length
          ? Math.max(...postOffsets) + 1
          : item.duration_days;
        setSteps((p) =>
          p.map((s) => (targetIds.has(s.id) ? { ...s, ...stepPatch(s) } : s)),
        );
        setItems((p) =>
          p.map((i) =>
            i.id === item.id
              ? { ...i, recurrence: nextRule, duration_days: newDur }
              : i,
          ),
        );
        persist(
          async () => {
            // ⚠️ This closure makes THREE sequential writes — updateItem, then
            // applyItemMove, then N x updateStep — and only the MIDDLE one is
            // atomic in itself. They are deliberately NOT version-guarded: each
            // write bumps `updated_at` on rows the next one would check, so a
            // guard would reject the second step of a gesture against the first
            // step of the same gesture. The result would be a PARTIAL APPLY —
            // the rule rotated and the occurrences did not — which is the
            // mixed-coordinates state the `origin_day_offset` design exists to
            // prevent, reached from the other side. Do not "finish the job"
            // here; folding the three into one transaction is what it would
            // take, and nothing today needs it.
            await updateItem(item.id, {
              recurrence: nextRule,
              duration_days: newDur,
            });
            // ⚠️ A day-move goes through applyItemMove, NOT N x updateStep, and
            // the reason is `origin_day_offset`.
            //
            // Rotating the rule moves the whole series: every non-detached
            // occurrence's `day_offset` shifts by `dayDelta`, so its
            // `origin_day_offset` — the slot the RULE put it in — must shift by
            // the same delta or the two coordinate systems drift apart. The
            // server materializer then tests `not exists (origin = o)` against
            // stale origins, finds nothing, and mints a duplicate on top of
            // every occurrence that already moved: ~9 duplicates from one drag.
            //
            // `updateStep` cannot fix this. It sees one row and one patch, and
            // a rotation's patch is indistinguishable from a single-occurrence
            // drag's — so it rightly refuses to guess and leaves origin alone
            // (the column is server-derived and never client-writable).
            // `applyItemMove` is the shape that *can*: N offsets on one item,
            // rebasing `origin_day_offset` server-side by the ITEM's delta
            // (`start_date`) plus whatever the caller states in `ruleDelta`.
            // Not by each row's own delta — that formula looks right and is
            // wrong, because `shift.ts` routes a per-occurrence drag through
            // this same RPC at a non-uniform delta, where origin must FREEZE.
            // It is also atomic, which N x updateStep never was — a half-applied
            // rotation left the series in mixed coordinates.
            if (dayDelta !== 0) {
              await applyItemMove({
                itemId: item.id,
                stepUpdates: targets.map((s) => ({
                  id: s.id,
                  day_offset: s.day_offset + dayDelta,
                })),
                newDuration: newDur,
                // ⚠️ REQUIRED here and nowhere else, and omitting it is silent.
                //
                // `origin_day_offset` lives in offsets-from-`start_date`, so
                // the RPC rebases it by the *item's* delta — which is 0 here,
                // because a rotation doesn't move `start_date`. But a rotation
                // DOES move every occurrence: the rule's weekday set rotates
                // and each non-detached step shifts by `dayDelta`. So origin
                // must shift by exactly that much, and only this caller knows.
                //
                // A rotation and an arrow-shift arrive at this RPC in the
                // IDENTICAL shape (N stepUpdates, no newStartDate) and need
                // OPPOSITE behaviour — freeze vs shift. No formula can tell
                // them apart, which is why the caller states it. Drop this line
                // and origins freeze while positions move; the materializer
                // then reads stale origins, mints on top of steps that already
                // moved, and the series silently doubles.
                ruleDelta: dayDelta,
              });
            }
            // The time fields don't live in offset space, so they don't rebase
            // anything and can stay on the simple path.
            const timePatch: Partial<Step> = {
              ...("time_of_day" in patch ? { time_of_day: patch.time_of_day } : {}),
              ...("duration_min" in patch
                ? { duration_min: patch.duration_min }
                : {}),
            };
            if (Object.keys(timePatch).length > 0) {
              await Promise.all(
                targets.map((s) => updateStep(s.id, timePatch)),
              );
            }
          },
          {
            keys: [
              "items:" + item.id,
              ...targets.map((s) => "steps:" + s.id),
            ],
          },
        );
      })();
    },
    [
      steps,
      itemsById,
      onUpdateStep,
      chooseRecurringScope,
      recordSnapshot,
    ],
  );

  const onCalendarDeleteStep = useCallback(
    (step: Step) => {
      const item = itemsById.get(step.item_id);
      const rule = item?.recurrence;
      if (!item || !rule) {
        void onDeleteStep(step);
        return;
      }
      void (async () => {
        const scope = await chooseRecurringScope({
          verb: "Delete",
          destructive: true,
        });
        if (!scope) return;
        const seriesSteps = steps.filter((s) => s.item_id === item.id);
        const targets =
          scope === "one"
            ? [step]
            : scope === "all"
              ? seriesSteps
              : seriesSteps.filter((s) => s.day_offset >= step.day_offset);
        // "All", or a "following" that sweeps every occurrence → the whole
        // series goes (an occurrence-less series is a zombie row).
        if (targets.length >= seriesSteps.length && scope !== "one") {
          recordSnapshot();
          sfx.deleted();
          setItems((p) => p.filter((i) => i.id !== item.id));
          setSteps((p) => p.filter((s) => s.item_id !== item.id));
          persist(() => deleteItem(item.id), { keys: ["items:" + item.id] });
          return;
        }
        recordSnapshot();
        sfx.deleted();
        const targetSet = new Set(targets.map((s) => s.id));
        // "Following" also ends the series the day before this occurrence,
        // so materialization never regrows what was deleted.
        const nextRule: Recurrence | null =
          scope === "following"
            ? { ...rule, until: isoAtOffset(item.start_date, step.day_offset - 1) }
            : null;
        const remaining = seriesSteps.filter((s) => !targetSet.has(s.id));
        const newDur = remaining.length
          ? Math.max(...remaining.map((s) => s.day_offset)) + 1
          : 1;
        setSteps((p) => p.filter((s) => !targetSet.has(s.id)));
        setItems((p) =>
          p.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  duration_days: newDur,
                  ...(nextRule ? { recurrence: nextRule } : {}),
                }
              : i,
          ),
        );
        persist(
          async () => {
            await Promise.all(
              Array.from(targetSet).map((id) => deleteStep(id)),
            );
            await updateItem(item.id, {
              duration_days: newDur,
              ...(nextRule ? { recurrence: nextRule } : {}),
            });
          },
          {
            keys: [
              ...Array.from(targetSet, (id) => "steps:" + id),
              "items:" + item.id,
            ],
          },
        );
      })();
    },
    [
      steps,
      itemsById,
      onDeleteStep,
      chooseRecurringScope,
      recordSnapshot,
    ],
  );

  const onCreateDeadline = useCallback(
    (input: { name: string; date: string }) => {
      recordSnapshot();
      setDeadlineModal(null);
      sfx.taskCreated();
      const deadlineId = crypto.randomUUID();
      const optim: Deadline = {
        id: deadlineId,
        board_id: activeBoardId,
        name: input.name,
        date: input.date,
        color: "#ef4444",
        created_at: new Date().toISOString(),
      };
      setDeadlines((p) => [...p, optim]);
      persist(
        async () => {
          const real = await createDeadline({
            ...input,
            id: deadlineId,
            board_id: activeBoardId,
          });
          if (real) {
            setDeadlines((p) => p.map((d) => (d.id === deadlineId ? real : d)));
          }
        },
        { keys: ["deadlines:" + deadlineId] },
      );
    },
    [recordSnapshot, activeBoardId],
  );

  const onDeleteDeadline = useCallback(
    async (d: Deadline) => {
      const ok = await dialogs.confirm({
        title: `Delete deadline "${d.name}"?`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      recordSnapshot();
      sfx.deleted();
      setDeadlines((p) => p.filter((x) => x.id !== d.id));
      persist(() => deleteDeadline(d.id), { keys: ["deadlines:" + d.id] });
    },
    [dialogs, recordSnapshot],
  );

  // The calendar's own control bar (Today / week nav / view switcher), rendered
  // inside the month-label bar à la Notion. In calendar views these live here;
  // the app TopBar only carries the view switcher for Gantt (see TopBar).
  const calendarControls = (
    <div className="flex items-center gap-2">
      <ViewMenu
        view={view}
        onGantt={() => setView("gantt")}
        onWeek={requestWeekView}
        onDay={() => requestDayView(dayViewDate ?? toISODate(new Date()))}
        showPast={showPast}
        onToggleShowPast={() => setShowPast((s) => !s)}
      />
      {view === "week" && (
        <>
          <button
            onClick={goThisWeek}
            disabled={isCurrentWeek}
            title="Jump to current week"
            className="rounded-md border border-border bg-surface px-3.5 py-1.5 text-[11.7px] font-medium text-text transition hover:bg-bg-elev disabled:cursor-default disabled:opacity-40"
          >
            Today
          </button>
          {/* Standalone chevrons — no boxed background, larger, spaced out. */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={goPrevWeek}
              title="Previous week (←)"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface hover:text-text"
            >
              <ChevronLeft width={19} height={19} />
            </button>
            <button
              onClick={goNextWeek}
              title="Next week (→)"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface hover:text-text"
            >
              <ChevronRight width={19} height={19} />
            </button>
          </div>
        </>
      )}
    </div>
  );


  return (
    <BoardEditContext.Provider value={editCtxValue}>
    <div
      className="relative flex h-screen flex-col bg-bg text-text"
      // `data-sidebar-collapsed` drives the global CSS rule in
      // globals.css that hides the contents of every sidebar div in
      // collapsed mode. The expand-chevron is marked `data-keep` to
      // stay visible despite the rule.
      data-sidebar-collapsed={sidebarCollapsed ? "true" : undefined}
      style={
        {
          // CSS variable consumed by every sidebar element across step-row,
          // markers, completed-section, collapsed-bars-summary, and the
          // header rows in this file. Updating it re-flows the whole
          // sidebar without re-rendering React.
          "--sidebar-w": `${effectiveSidebarW}px`,
        } as React.CSSProperties
      }
    >
      <Personalization
        accentColor={settings.accentColor}
      />
      {banner}
      <TopBar
        boardName={boardName}
        onRenameBoard={onRenameBoard}
        view={view}
        onViewChange={setView}
        onWeekView={requestWeekView}
        onPrevWeek={goPrevWeek}
        onNextWeek={goNextWeek}
        onThisWeek={goThisWeek}
        isCurrentWeek={isCurrentWeek}
        showPast={showPast}
        onToggleShowPast={() => setShowPast((s) => !s)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onDayView={() => requestDayView(dayViewDate ?? toISODate(new Date()))}
        isMobile={viewport.isMobile}
      />

      {(view === "week" || view === "day") && (
        // Calendar area: a left sidebar (Notion-style) + the calendar. The
        // TopBar above stays full-width; everything here — the sidebar, the
        // calendar columns, the month label — sits to the right of it.
        <div className="flex min-h-0 flex-1">
          <aside
            className={cn(
              "flex shrink-0 flex-col border-r border-border bg-bg-elev transition-[width] duration-150",
              calSidebarCollapsed ? "w-14" : "w-64",
            )}
          >
            <div className="flex items-center px-3 py-2">
              <button
                onClick={() => setCalSidebarCollapsed((c) => !c)}
                title={calSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="flex h-8 w-8 items-center justify-center rounded-md text-text-dim transition hover:bg-surface hover:text-text-muted"
              >
                <PanelLeft width={18} height={18} />
              </button>
            </div>
            {!calSidebarCollapsed && (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <div className="mt-1 shrink-0">
                  <MiniMonthLive
                    focusedISO={calFocusedISO}
                    bandDays={view === "day" ? 1 : 7}
                    onPickDate={goToDate}
                    register={registerLivePan}
                  />
                </div>
                <div className="my-2 shrink-0" />
                <SidebarUnscheduled
                  steps={steps}
                  items={items}
                  blocks={blocks}
                  onBeginDrag={onCardBeginDrag}
                  date={unscheduledDate}
                  onDateChange={setUnscheduledDate}
                />
              </div>
            )}
          </aside>
          {view === "week" && (
            <CalendarView
              blocks={blocks}
              items={items}
              steps={steps}
              daysToShow={7}
              onCreateTask={onCreateCalendarTask}
              startDate={weekStartISO}
              onShiftDays={(delta) =>
                setWeekStartISO((iso) =>
                  toISODate(addDays(parseISODate(iso), delta)),
                )
              }
              onLivePan={onCalLivePan}
              settings={settings}
              onUpdateStep={onCalendarUpdateStep}
              onRepeatStep={onRepeatStep}
              onUpdateItem={onUpdateItem}
              onDeleteStep={onCalendarDeleteStep}
              onToggleStepDone={onToggleStepDone}
              onPickDay={(iso) => {
                setDayViewDate(iso);
                setUnscheduledDate(iso);
                setView("day");
              }}
              flashDate={flashDayISO}
              headerControls={calendarControls}
              registerBeginDrag={registerBeginDrag}
              onFocusDay={setUnscheduledDate}
            />
          )}

          {view === "day" && (
            <CalendarView
              blocks={blocks}
              items={items}
              steps={steps}
              daysToShow={1}
              onCreateTask={onCreateCalendarTask}
              settings={settings}
              startDate={dayViewDate ?? toISODate(new Date())}
              onUpdateStep={onCalendarUpdateStep}
              onRepeatStep={onRepeatStep}
              onUpdateItem={onUpdateItem}
              onDeleteStep={onCalendarDeleteStep}
              onToggleStepDone={onToggleStepDone}
              onPickDay={(iso) => {
                setDayViewDate(iso);
                setUnscheduledDate(iso);
              }}
              onBackToWeek={() => setView("week")}
              headerControls={calendarControls}
              registerBeginDrag={registerBeginDrag}
              onFocusDay={setUnscheduledDate}
            />
          )}
        </div>
      )}

      {view === "gantt" &&
        (() => {
          // Pins are effectively per-board: `pinnedItemIds` is global (it lives
          // in settings), but only the active board's items are loaded, so
          // filtering against `items` naturally drops any pinned id that
          // belongs to another board. Pins for other boards are preserved in
          // settings (the pin modal seeds from the full list) and reappear when
          // that board is loaded.
          const pinnedItems = items.filter((i) => pinnedItemIds.includes(i.id));
          // Stored deadline_offset is a user-set floor; displayed column is
          // max(stored, max step.day_offset + 1) so steps push it forward but
          // it never drifts backward on its own.
          const pinnedDeadlineDates = new Map<string, string>();
          for (const it of pinnedItems) {
            const stepOffsets = (stepsByItem.get(it.id) ?? []).map(
              (s) => s.day_offset,
            );
            const eff = effectiveDeadlineOffset(
              it.deadline_offset,
              stepOffsets,
            );
            pinnedDeadlineDates.set(it.id, isoAtOffset(it.start_date, eff));
          }

          // Greedy-pack flag pills onto rows. Deadlines use their full
          // name width; pinned items use a fixed tiny width (flag +
          // countdown only — the full title is in the chip rail below)
          // so 5-6 pinned items pack onto a single row even when their
          // dates collide.
          const PINNED_PILL_W = 52;
          const pills: { key: string; left: number; width: number }[] = [];
          for (const d of deadlines) {
            const idx = dayISOs.indexOf(d.date);
            if (idx < 0) continue;
            pills.push({
              key: `d:${d.id}`,
              left: idx * colW,
              width: estimatePillWidth(d.name),
            });
          }
          for (const it of pinnedItems) {
            const date = pinnedDeadlineDates.get(it.id);
            if (!date) continue;
            const idx = dayISOs.indexOf(date);
            if (idx < 0) continue;
            pills.push({
              key: `p:${it.id}`,
              left: idx * colW,
              width: PINNED_PILL_W,
            });
          }
          const { rowByKey: pillRow, rowEnds } = greedyPack(pills, 4);
          const PILL_ROW_H = 22;
          const pillRowCount = rowEnds.length;
          // The deadlines strip now shows ONLY when something is pinned — the
          // "Pin" action moved up to the month bar, so there's no need to keep
          // an empty row around for it. Zero height (and the row is skipped
          // entirely below) means the date columns sit flush under the month
          // label when nothing is pinned.
          const deadlineRowH =
            pillRowCount === 0 ? 0 : pillRowCount * PILL_ROW_H + 4;
          const PINNED_RAIL_H = pinnedItems.length > 0 ? 28 : 0;
          // The sticky header INSIDE the scroll is only: the (conditional)
          // deadlines-marker strip, the pinned chip rail, and the date columns.
          // The month-range label AND the board actions (New item / New block /
          // Pin) live in the standalone month bar ABOVE the scroll (see the
          // gantt branch) — a separate column-stack from the sidebar, so they
          // never force height onto the date grid. This mirrors the calendar,
          // whose month bar is its own row beside a genuinely separate <aside>.
          const HEADER_H = deadlineRowH + PINNED_RAIL_H + DATE_ROW_H;

          // Honest month-range label from the visible days: "July 2026" when
          // the window sits in one month, "May – Jul 2026" across months of
          // one year, "Dec 2025 – Feb 2026" across a year boundary.
          const rangeLabel = (() => {
            const first = days[0];
            const last = days[days.length - 1];
            if (!first || !last) return "";
            const mShort = (d: Date) =>
              d.toLocaleDateString(undefined, { month: "short" });
            const mLong = (d: Date) =>
              d.toLocaleDateString(undefined, { month: "long" });
            const sy = first.getFullYear();
            const ey = last.getFullYear();
            if (sy === ey && first.getMonth() === last.getMonth())
              return `${mLong(first)} ${sy}`;
            if (sy === ey) return `${mShort(first)} – ${mShort(last)} ${ey}`;
            return `${mShort(first)} ${sy} – ${mShort(last)} ${ey}`;
          })();

          // Weekend alignment for the gridline background: days[0] is the
          // leftmost visible day, so the weekday of column 0 anchors the
          // weekend washes + week-boundary lines that tile every 7 columns.
          const dow0 = days[0]?.getDay() ?? 0;
          const isWeekendCol = (k: number) => {
            const d = (dow0 + k) % 7;
            return d === 0 || d === 6;
          };

          // Consolidated gridline background — one system, three layers:
          //  1. the base per-column vertical line,
          //  2. a stronger line every 7th column (week boundary, ~2.5× base),
          //  3. a borderless wash over each weekend column.
          // All three tile from days[0] (the grid's left edge) so the weekly
          // rhythm stays aligned as the window pans. Per-cell borders are gone;
          // this pattern is the single source of vertical structure.
          const baseOp = settings.gridlinesOpacity;
          const weekOp = Math.min(1, baseOp * 2.5);
          const tileW = colW * 7;
          const weekendStops: string[] = [];
          for (let k = 0; k < 7; k++) {
            if (!isWeekendCol(k)) continue;
            const s = k * colW;
            const e = (k + 1) * colW;
            weekendStops.push(
              `transparent ${s}px`,
              `color-mix(in srgb, var(--text) 3%, transparent) ${s}px`,
              `color-mix(in srgb, var(--text) 3%, transparent) ${e}px`,
              `transparent ${e}px`,
            );
          }
          // Weekend accent lives on the column HEADER now (light gray), not a
          // full-height body wash.
          void weekendStops;
          const gridImage = [
            `linear-gradient(to right, rgba(var(--gridline-rgb), ${baseOp}) 1px, transparent 1px)`,
            `linear-gradient(to right, rgba(var(--gridline-rgb), ${weekOp}) 1px, transparent 1px)`,
          ].join(", ");
          const gridSize = [`${colW}px 100%`, `${tileW}px 100%`].join(", ");

          return (
            <>
            {/* Standalone month bar — its own row above the scroll, exactly like
                the calendar's. A sidebar-width corner (the collapse toggle, à la
                the calendar's PanelLeft) sits over the sidebar; the month label
                begins above the date columns. It is NOT part of the scroll's
                sticky sidebar stack, so the sidebar and the label are fully
                decoupled — neither forces height on the other. */}
            <div className="flex shrink-0 items-stretch bg-bg-elev">
              {/* Sidebar corner: the board actions (New item / New block).
                  These used to live in a dedicated action row inside the
                  scroll's sticky header, which pushed the date columns down.
                  Hoisting them here — where the calendar keeps its aside chrome —
                  lets the date grid sit flush under the month label. */}
              <div
                className={cn(
                  "flex shrink-0 items-center gap-1.5 border-r border-border py-2",
                  sidebarCollapsed ? "justify-center px-0" : "px-3",
                )}
                style={{ width: effectiveSidebarW }}
              >
                {!sidebarCollapsed && (
                  <>
                    <button
                      onClick={() => setItemModal({})}
                      className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[11.2px] font-medium text-white shadow-sm transition hover:brightness-110"
                      title="New item (C)"
                    >
                      <ListTodo width={14} height={14} className="shrink-0" />
                      <span className="min-w-0 truncate">New item</span>
                    </button>
                    <button
                      onClick={() => setBlockModal({})}
                      title="New block"
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md transition hover:brightness-125"
                      style={{
                        // Low-opacity blue block + a full-colour blue brick.
                        background:
                          "color-mix(in srgb, var(--accent) 16%, transparent)",
                        color: "var(--accent)",
                      }}
                    >
                      <ToyBrick width={12} height={12} />
                    </button>
                  </>
                )}
              </div>
              <div className="flex flex-1 items-center gap-3 py-2 pl-4 pr-3">
                <h2 className="text-[19.8px] font-semibold tracking-tight text-text">
                  {rangeLabel}
                </h2>
                {/* All nav controls pinned to the right. */}
                <div className="ml-auto flex items-center gap-1.5">
                  {/* View dropdown — sits just left of Today. */}
                  <ViewMenu
                    view={view}
                    onGantt={() => setView("gantt")}
                    onWeek={requestWeekView}
                    onDay={() =>
                      requestDayView(dayViewDate ?? toISODate(new Date()))
                    }
                    showPast={showPast}
                    onToggleShowPast={() => setShowPast((s) => !s)}
                  />
                  {/* Today — styled like the dropdown, no icon. */}
                  <button
                    onClick={() => {
                      if (!scrollRef.current || todayIndex < 0) return;
                      scrollRef.current.scrollTo({
                        left: Math.max(0, todayIndex * colW - 80),
                        behavior: "smooth",
                      });
                    }}
                    title="Scroll to today (T)"
                    className="rounded-md border border-border bg-surface px-3.5 py-1.5 text-[11.7px] font-medium text-text transition hover:bg-bg-elev"
                  >
                    Today
                  </button>
                  {/* Pin + eye — icon-only, kept tight together. */}
                  <div className="ml-1 flex items-center gap-0.5">
                    <button
                      onClick={() => setPinModalOpen(true)}
                      title="Pin items to the deadlines strip"
                      className="flex items-center justify-center rounded-md p-1.5 text-text-muted transition hover:bg-surface hover:text-text"
                    >
                      <Pin width={14} height={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const todayISO =
                          dayISOs[todayIndex] ?? toISODate(new Date());
                        toggleFocusedDay(focusedDayISO ?? todayISO);
                      }}
                      title={
                        focusedDayISO
                          ? "Exit day focus (Esc)"
                          : "Focus on today (only today's tasks)"
                      }
                      aria-pressed={!!focusedDayISO}
                      className={cn(
                        "flex items-center justify-center rounded-md p-1.5 transition",
                        focusedDayISO
                          ? "bg-accent/15 text-accent"
                          : "text-text-muted hover:bg-surface hover:text-text",
                      )}
                    >
                      {focusedDayISO ? (
                        <Eye width={14} height={14} />
                      ) : (
                        <EyeOff width={14} height={14} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div
              ref={scrollRef}
              onPointerDown={onGanttBodyPointerDown}
              onScroll={(e) => {
                ganttScrollLeftRef.current = e.currentTarget.scrollLeft;
              }}
              className="relative flex-1 overflow-auto select-none"
              style={{
                overscrollBehavior: "contain",
                // Chrome's scroll anchoring "helpfully" adjusts scroll offsets
                // when content changes around the anchor node — in a grid whose
                // left edge grows/shrinks with data (pastDays) and which does
                // its own scroll compensation, that reads as a random sideways
                // jerk after edits. Same fix the calendar's pan window ships.
                overflowAnchor: "none",
                // Reserve space at the bottom so a floating element never
                // obscures the last row: the nav pill on mobile, the
                // all-done toast on desktop (when the sidebar is open).
                paddingBottom: viewport.isMobile
                  ? 96
                  : !sidebarCollapsed
                    ? 88
                    : undefined,
              }}
            >
              <div
                className="relative"
                style={{
                  width: `calc(var(--sidebar-w) + ${gridWidth}px)`,
                  minHeight: "100%",
                  // Only render *vertical* structure from the background pattern
                  // (base line + week-boundary line + weekend wash — see gridImage
                  // above). Horizontal lines from a repeating pattern would drift,
                  // because row heights vary (block/item/step/draft). Rows supply
                  // their own horizontal borders.
                  backgroundImage: settings.gridlines ? gridImage : undefined,
                  backgroundSize: settings.gridlines ? gridSize : undefined,
                  backgroundPosition: settings.gridlines
                    ? `var(--sidebar-w) ${HEADER_H}px`
                    : undefined,
                  backgroundRepeat: settings.gridlines ? "repeat-x" : undefined,
                }}
              >
                <DateHeader
                  days={days}
                  dayISOs={dayISOs}
                  colW={colW}
                  setColW={setColW}
                  deadlines={deadlines}
                  todayIndex={todayIndex}
                  pinnedItems={pinnedItems}
                  pinnedDeadlineDates={pinnedDeadlineDates}
                  pillRow={pillRow}
                  pillRowH={PILL_ROW_H}
                  deadlineRowH={deadlineRowH}
                  onUnpinItem={(id) => {
                    recordSnapshot();
                    setPinnedItemIds((p) => p.filter((x) => x !== id));
                  }}
                  onJumpToPinnedItem={triggerJumpToItem}
                  onDeleteDeadline={onDeleteDeadline}
                  gridWidth={gridWidth}
                  focusedDayISO={focusedDayISO}
                  onToggleFocusedDay={toggleFocusedDay}
                  sidebarCollapsed={sidebarCollapsed}
                  sidebarW={sidebarW}
                  onSidebarResize={setSidebarW}
                  firstBlockHeader={(() => {
                    // The pinned block-header slot: shows the block whose
                    // section is currently under the sticky header (scroll-
                    // tracked), with an iOS-style push transition — the next
                    // block's header slides up and shoves the current one out,
                    // then locks. Two absolutely-positioned layers inside a
                    // clipping wrapper; per-frame transforms are written
                    // imperatively by the scroll tracker.
                    if (isFocused) return null;
                    const resolve = (id: string | null) => {
                      const x = id
                        ? orderedBlocks.find((o) => o.id === id)
                        : undefined;
                      return x && !x.is_system && !x.archived ? x : undefined;
                    };
                    const b = resolve(pinnedBlockId) ?? orderedBlocks[0];
                    if (!b || b.is_system || b.archived) return null;
                    const up = resolve(upcomingBlockId);
                    const headerFor = (blk: Block) => (
                      <MergedBlockHeader
                        block={blk}
                        itemCount={(itemsByBlock.get(blk.id) ?? []).length}
                        onToggleBlock={() => onToggleBlock(blk)}
                        onEditBlock={() => setBlockModal({ block: blk })}
                        onDeleteBlock={() => onDeleteBlock(blk)}
                        onNewItem={() =>
                          setItemModal({ defaultBlockId: blk.id })
                        }
                      />
                    );
                    return (
                      <div className="relative h-full min-w-0 flex-1 overflow-hidden">
                        <div
                          key={b.id}
                          data-pinned-current=""
                          className="absolute inset-0 flex items-center will-change-transform"
                        >
                          {headerFor(b)}
                        </div>
                        {up && up.id !== b.id && (
                          <div
                            key={up.id}
                            data-pinned-next=""
                            className="absolute inset-0 flex items-center will-change-transform"
                            style={{
                              transform: `translateY(${DATE_ROW_H}px)`,
                            }}
                          >
                            {headerFor(up)}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                />

                {/* Search / jump column flash — two pulses of green over
                 *  the matched day's column, full body height. Sits
                 *  above the today tint so it's visible even on today. */}
                {flashDayISO &&
                  (() => {
                    const flashIdx = days.findIndex(
                      (d) => toISODate(d) === flashDayISO,
                    );
                    if (flashIdx < 0) return null;
                    return (
                      <div
                        data-search-flash=""
                        aria-hidden
                        className="pointer-events-none absolute"
                        style={{
                          left: `calc(var(--sidebar-w) + ${flashIdx * colW}px)`,
                          top: 0,
                          width: colW,
                          bottom: 0,
                          zIndex: 46,
                        }}
                      />
                    );
                  })()}

                {/* Today lives only in the column header chip now — the
                    full-height body overlay read as a heavy blue band. */}

                <div className="relative">
                  {orderedBlocks.map((block, blockIndex) =>
                    block.is_system && block.name === "Completed" ? (
                      // Hide Completed in day-focus mode on desktop
                      // (nothing to do there for the day's planning).
                      // On mobile, focus mode is auto-on, so hiding
                      // would make Completed unreachable entirely —
                      // keep it visible.
                      isFocused && !viewport.isMobile ? null : (
                        <CompletedSection
                          key={block.id}
                          block={block}
                          entries={completedStepEntries}
                          onToggleBlock={() => onToggleBlock(block)}
                          onToggleStepDone={onToggleStepDone}
                          onDeleteStep={onDeleteStep}
                          gridWidth={gridWidth}
                        />
                      )
                    ) : (
                      <BlockSection
                        key={block.id}
                        block={block}
                        blockIndex={blockIndex}
                        // First active block's header is hoisted into the
                        // date-header band, so suppress its own header row.
                        hideHeader={
                          blockIndex === 0 &&
                          !block.is_system &&
                          !block.archived
                        }
                        items={itemsByBlock.get(block.id) ?? []}
                        stepsByItem={visibleStepsByItem}
                        collapsedItems={collapsedItems}
                        forceExpanded={isFocused}
                        onToggleItem={onToggleItemCollapsed}
                        rowH={rowH}
                        setRowH={setRowH}
                        // ⚠️ Per-block override FIRST, document default
                        // second — never a literal. A lane only gains a key
                        // in `chipModeByBlock` when somebody chooses for it
                        // (Shift+T / Shift+E stamp every lane then on the
                        // board), so a lane made after that choice has no
                        // entry and must fall through to `defaultChipMode`
                        // — which is what the Settings control calls
                        // itself: "Default chip for new blocks". `settings`
                        // is `ResolvedSettings`, so that fallback is always
                        // a real "T" | "E"; a third `?? "T"` does not
                        // belong here, it would outrank a stored "E".
                        chipMode={
                          chipModeByBlock[block.id] ?? settings.defaultChipMode
                        }
                        setChipMode={(m) => onSetChipMode(block.id, m)}
                        days={days}
                        colW={colW}
                        rangeStartISO={rangeStartISO}
                        gridWidth={gridWidth}
                        freshlyCreatedId={freshlyCreatedId}
                        onToggleBlock={() => onToggleBlock(block)}
                        onEditBlock={() => setBlockModal({ block })}
                        onDeleteBlock={() => onDeleteBlock(block)}
                        onNewItem={(prefill) =>
                          setItemModal({
                            defaultBlockId: block.id,
                            defaultStart: prefill?.start,
                            defaultDuration: prefill?.duration,
                          })
                        }
                        onEditItem={(item) => setItemModal({ item })}
                        onUpdateItem={onUpdateItem}
                        onResizeItem={onResizeItem}
                        onAddStep={onAddStep}
                        onDeleteItem={onDeleteItem}
                        onUpdateStep={onUpdateStep}
                        onRepeatStep={onRepeatStep}
                        onToggleStepDone={onToggleStepDone}
                        onDeleteStep={onDeleteStep}
                        onSwapSteps={onSwapSteps}
                        selection={selection}
                        selectedItemIds={selectedItemIds}
                        copiedStepIds={copiedStepIds}
                        onMultiBodyShift={onMultiBodyShift}
                        onLeftPull={applyLeftPull}
                        onSelectItem={selectItem}
                        onCellPointerDown={onCellPointerDown}
                        onClearSelection={dropPaintedSelection}
                        onRecordCellAnchor={recordCellAnchor}
                        onConfirmShiftDeadline={confirmShiftDeadline}
                        flashItemId={flashItemId}
                        compactSteps={viewport.isMobile}
                        // Archived blocks render read-only: dimmed, lock
                        // pill, no mutating handlers, with a Reactivate
                        // action. Archiving preserves, it never deletes.
                        locked={block.archived}
                        onActivate={() => onActivateBlock(block.id)}
                      />
                    ),
                  )}

                  {isFocused &&
                    orderedBlocks.every(
                      (b) =>
                        b.is_system ||
                        (itemsByBlock.get(b.id) ?? []).length === 0,
                    ) && (
                      <div
                        className="sticky left-0 z-50 flex items-center gap-3 bg-bg px-8 py-6 text-[11.2px] italic text-text-dim"
                        data-gantt-sidebar=""
                        style={{
                          width: "var(--sidebar-w)",
                          overflow: "hidden",
                          borderRight: "1px solid var(--border)",
                        }}
                      >
                        <span>
                          Nothing scheduled for{" "}
                          {fmtFull(parseISODate(focusedDayISO!))}.
                        </span>
                        <button
                          onClick={() => setFocusedDayISO(null)}
                          className="not-italic font-medium text-accent hover:underline"
                        >
                          Show all
                        </button>
                      </div>
                    )}

                  {/* "Add block" lives in the top bar (search + folder-plus). */}

                  <div style={{ height: 100 }} />
                </div>
              </div>
            </div>
            </>
          );
        })()}

      {lasso && (
        <div
          className="pointer-events-none fixed z-50 rounded-sm border border-accent bg-accent/15"
          style={{
            left: Math.min(lasso.origin.x, lasso.current.x),
            top: Math.min(lasso.origin.y, lasso.current.y),
            width: Math.abs(lasso.current.x - lasso.origin.x),
            height: Math.abs(lasso.current.y - lasso.origin.y),
          }}
        />
      )}

      <BlockModal
        open={blockModal != null}
        initial={blockModal?.block}
        onClose={() => setBlockModal(null)}
        onSubmit={(input) =>
          blockModal?.block
            ? onEditBlock(blockModal.block.id, input)
            : onCreateBlock(input)
        }
      />
      <ItemModal
        open={itemModal != null}
        blocks={orderedBlocks.filter((b) => !b.is_system && !b.archived)}
        defaultBlockId={(() => {
          // ⚠️ `lastBlockId` can be stale — the lane may have been deleted
          // since the last task was made, and nothing clears the setting when
          // that happens. Dropping an id that no longer resolves is the check;
          // doing it here rather than on delete keeps the settings write off
          // the delete path, where it would be one more thing to undo.
          const fromModal = itemModal?.defaultBlockId;
          const candidate = fromModal ?? lastBlockId ?? undefined;
          if (!candidate) return undefined;
          return blocks.some((b) => b.id === candidate) ? candidate : undefined;
        })()}
        defaultStart={itemModal?.defaultStart}
        defaultDuration={itemModal?.defaultDuration}
        initial={itemModal?.item}
        onClose={() => setItemModal(null)}
        onSubmit={(input) => {
          if (itemModal?.item) {
            const it = itemModal.item;
            // Send only what actually changed, so a no-op "Save" writes
            // nothing.
            const patch: Partial<Item> = {};
            if (input.title !== it.title) patch.title = input.title;
            if (input.blockId !== it.block_id) patch.block_id = input.blockId;
            if (input.startDate !== it.start_date)
              patch.start_date = input.startDate;
            if (Object.keys(patch).length > 0) onUpdateItem(it.id, patch);
            if (input.durationDays !== it.duration_days) {
              onResizeItem(it, input.durationDays);
            }
            setItemModal(null);
          } else {
            onCreateItem(input);
          }
        }}
      />
      <DateJumpModal
        open={dateJumpOpen}
        onClose={() => setDateJumpOpen(false)}
        onJump={jumpToDate}
      />
      <PinDeadlinesModal
        open={pinModalOpen}
        items={items}
        blocks={blocks}
        initialPinned={pinnedItemIds}
        onClose={() => setPinModalOpen(false)}
        onSave={(ids) => {
          recordSnapshot();
          setPinnedItemIds(ids);
        }}
      />
      <DeadlineModal
        open={deadlineModal != null}
        initialDate={deadlineModal?.date}
        onClose={() => setDeadlineModal(null)}
        onSubmit={onCreateDeadline}
      />
      <SearchModal
        open={searchOpen}
        blocks={blocks}
        items={items}
        steps={steps}
        deadlines={deadlines}
        onClose={() => setSearchOpen(false)}
        onJumpToItem={triggerJumpToItem}
        onJumpToBlock={(block) => {
          // Jump to the block's first item; falls back to opening the
          // block's edit modal when the block has no items.
          const firstItem = items.find(
            (i) =>
              i.block_id === block.id &&
              !blocks.find((b) => b.id === i.block_id)?.is_system,
          );
          if (firstItem) triggerJumpToItem(firstItem);
          else setBlockModal({ block });
        }}
      />
      <AllTasksCompletePopup
        show={allDonePopup}
        onDismiss={() => setAllDonePopup(false)}
        showWeekCTA={view !== "week"}
        onSeeTomorrow={() => {
          requestWeekView();
          setAllDonePopup(false);
          // Flash tomorrow's column once the week view mounts. RAFs
          // give the calendar time to render its day columns before
          // the overlay tries to land on one.
          const t = new Date();
          t.setDate(t.getDate() + 1);
          const tomorrow = toISODate(t);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setFlashDayISO(tomorrow));
          });
        }}
      />
      {viewport.isMobile && (
        <MobileBottomNav
          view={view}
          onSetView={(v) => {
            if (v !== "gantt") {
              requestWeekView();
              return;
            }
            setView(v);
          }}
          theme={theme}
          onToggleTheme={() =>
            setTheme((t) => (t === "dark" ? "light" : "dark"))
          }
        />
      )}
    </div>
    </BoardEditContext.Provider>
  );
}

function AllTasksCompletePopup({
  show,
  onDismiss,
  showWeekCTA,
  onSeeTomorrow,
}: {
  show: boolean;
  onDismiss: () => void;
  showWeekCTA: boolean;
  onSeeTomorrow: () => void;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
          style={{
            background: "var(--frost, var(--bg-elev))",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid color-mix(in srgb, var(--text) 12%, transparent)",
          }}
          className="fixed bottom-5 left-5 z-50 flex max-w-xs items-start gap-3 rounded-xl px-4 py-3 shadow-2xl shadow-black/40"
          role="status"
        >
          <span className="text-2xl leading-none" aria-hidden>
            🎉
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11.7px] font-semibold tracking-tight">
              All tasks complete!
            </div>
            {showWeekCTA ? (
              <button
                onClick={onSeeTomorrow}
                className="mt-1 rounded-md bg-accent/15 px-2 py-1 text-[10.3px] font-medium text-accent transition hover:bg-accent/25"
              >
                See what&apos;s in store tomorrow →
              </button>
            ) : (
              <div className="mt-0.5 text-[10.3px] text-text-muted">
                See what&apos;s in store tomorrow?
              </div>
            )}
          </div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 rounded p-1 text-text-dim transition hover:bg-surface hover:text-text"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Top bar ─────────────────────────────────────────────────────────────
function TopBar({
  boardName,
  onRenameBoard,
  view,
  onViewChange,
  onWeekView,
  onPrevWeek,
  onNextWeek,
  onThisWeek,
  isCurrentWeek,
  showPast,
  onToggleShowPast,
  theme,
  onToggleTheme,
  onDayView,
  isMobile,
}: {
  /** Active board name, shown and inline-edited in the bar. */
  boardName: string;
  /** Commit a board rename — wired to the parent's optimistic `updateBoard`. */
  onRenameBoard: (name: string) => void;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  /** Entry into the week view. */
  onWeekView: () => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  isCurrentWeek: boolean;
  showPast: boolean;
  onToggleShowPast: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  /** Switch into day view (used by the view dropdown + the "3" shortcut). */
  onDayView: () => void;
  isMobile: boolean;
}) {
  // Mobile gets a stripped-down bar: just identity + the two actions
  // that actually make sense on a phone (search + settings). Everything
  // else (view toggle, past expand, theme, +New) is desktop-only.
  if (isMobile) {
    // Identity on the left, settings cog on the right. View switching
    // (Day/Week) lives in the floating bottom pill within thumb reach.
    return (
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg-elev px-3">
        <div className="flex min-w-0 items-center gap-2">
          <LogoMark />
          <h1 className="truncate text-sm font-medium tracking-tight">
            {PRODUCT_NAME}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/settings"
            title="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted active:bg-surface"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        </div>
      </header>
    );
  }
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-elev px-4">
      <div className="flex items-center gap-2">
        <LogoMark />
        <h1 className="text-sm font-medium tracking-tight">{PRODUCT_NAME}</h1>
        {/* Back to the Drive-style home screen (the board list). */}
        <Link
          href="/app"
          title="All boards"
          className="ml-1 flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-text-muted transition hover:bg-surface hover:text-text"
        >
          <ChevronLeft width={13} height={13} />
          Boards
        </Link>
        <span className="text-xs text-text-dim">/</span>
        {/* Board name — editable inline. */}
        <BoardName name={boardName} onRename={onRenameBoard} />
      </div>

      <div className="flex items-center gap-1">
        {/* Today / week-nav / the view switcher live in each view's own
            month bar now (the calendar's, and the Gantt's new range bar) —
            the TopBar no longer carries the view switcher. */}
        <button
          onClick={onToggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition hover:bg-surface hover:text-text"
        >
          {theme === "dark" ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <Link
          href="/settings"
          title="Settings"
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition hover:bg-surface hover:text-text"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>
    </header>
  );
}

/**
 * View switcher — a single dropdown collapsing Gantt / Week / Day (Day is a
 * first-class, visible view). The active view is checked. The "show past days"
 * horizon control lives here too (gantt only) as a pill toggle.
 */
function ViewMenu({
  view,
  onGantt,
  onWeek,
  onDay,
  showPast,
  onToggleShowPast,
}: {
  view: ViewMode;
  onGantt: () => void;
  onWeek: () => void;
  onDay: () => void;
  showPast: boolean;
  onToggleShowPast: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => [wrapRef], []);
  useOutsideClick(refs, () => setOpen(false));
  // ⚠️ `open` is the second argument, and it is load-bearing rather than tidy.
  // `useEscape`'s single capture-phase listener `stopPropagation()`s whenever
  // the stack is non-empty, so a CLOSED dismissable that still registers eats
  // the key for everything underneath it. This menu is mounted for the whole
  // life of the board, so registering unconditionally made Escape inert on the
  // board itself: MEASURED — the cells selection was never cleared, the
  // marching-ants copy outline never dismissed and day-focus never exited,
  // because the board's own keydown listener is on the bubble phase and never
  // saw the event. Register only while the menu is actually open.
  useEscape(() => setOpen(false), open);

  const label = view === "gantt" ? "Gantt" : view === "week" ? "Week" : "Day";
  const rows: { key: ViewMode; label: string; onClick: () => void }[] = [
    { key: "gantt", label: "Gantt", onClick: onGantt },
    { key: "week", label: "Week", onClick: onWeek },
    { key: "day", label: "Day", onClick: onDay },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Switch view"
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface py-1.5 pl-4 pr-3 text-[11.7px] font-medium text-text transition hover:bg-bg-elev"
      >
        {label}
        <ChevronDown
          width={12}
          height={12}
          className={cn(
            "text-text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            style={{
              background: "color-mix(in srgb, var(--bg-elev) 82%, transparent)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              border: "1px solid color-mix(in srgb, var(--text) 12%, transparent)",
            }}
            className="absolute left-0 top-full z-[80] mt-1.5 w-44 rounded-xl p-1 shadow-2xl shadow-black/40"
          >
            {rows.map((r) => {
              const active = r.key === view;
              return (
                <button
                  key={r.key}
                  onClick={() => {
                    r.onClick();
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[11.7px] transition",
                    active
                      ? "bg-accent/12 font-medium text-accent"
                      : "text-text hover:bg-surface",
                  )}
                >
                  <span className="flex items-center gap-1.5">{r.label}</span>
                  {active && (
                    <svg
                      width={13}
                      height={13}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
            {view === "gantt" && (
              <>
                <div className="mx-1 my-1 h-px bg-border" />
                <button
                  onClick={onToggleShowPast}
                  title={showPast ? "Hide older days" : "Show more past days"}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[11.7px] text-text transition hover:bg-surface"
                >
                  Show past days
                  <PillToggle on={showPast} />
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Apple-style pill toggle that inherits the accent color when on. */
function PillToggle({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-accent" : "bg-border",
      )}
      aria-hidden
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform",
          on ? "translate-x-[15px]" : "translate-x-[3px]",
        )}
      />
    </span>
  );
}

// ─── Date header ─────────────────────────────────────────────────────────
function DateHeader({
  days,
  dayISOs,
  colW,
  setColW,
  deadlines,
  todayIndex,
  onDeleteDeadline,
  gridWidth,
  pinnedItems,
  pinnedDeadlineDates,
  pillRow,
  pillRowH,
  deadlineRowH,
  onUnpinItem,
  onJumpToPinnedItem,
  focusedDayISO,
  onToggleFocusedDay,
  sidebarCollapsed,
  sidebarW,
  onSidebarResize,
  firstBlockHeader,
}: {
  days: Date[];
  dayISOs: string[];
  colW: number;
  setColW: (n: number) => void;
  deadlines: Deadline[];
  todayIndex: number;
  onDeleteDeadline: (d: Deadline) => void;
  gridWidth: number;
  pinnedItems: Item[];
  pinnedDeadlineDates: Map<string, string>;
  pillRow: Map<string, number>;
  pillRowH: number;
  deadlineRowH: number;
  onUnpinItem: (id: string) => void;
  onJumpToPinnedItem: (item: Item) => void;
  focusedDayISO: string | null;
  onToggleFocusedDay: (iso: string) => void;
  sidebarCollapsed: boolean;
  sidebarW: number;
  onSidebarResize: (w: number) => void;
  /** The first block's header, hoisted into the date-row sidebar cell (null
   *  when there's no mergeable first block, or in focus mode). */
  firstBlockHeader?: React.ReactNode;
}) {
  // Sidebar resize: spreadsheet-style guideline + commit-on-release.
  const sidebarDrag = useResizeDrag({
    axis: "x",
    min: MIN_SIDEBAR_W,
    max: MAX_SIDEBAR_W,
    onCommit: onSidebarResize,
  });

  return (
    <div
      // z-[70] so this sticky-top header stays above every sticky-
      // left sidebar cell in the rows below (item/step/block sidebars
      // are z-50). Without this, scrolling down lets the row sidebars
      // slide on top of the deadlines/new-block/date strip. Also
      // covers the today line (z-45) and column flash (z-46) which
      // live OUTSIDE this wrapper in the scroll body.
      className="sticky top-0 z-[70] bg-bg-elev backdrop-blur"
      data-gantt-header=""
    >
      {deadlineRowH > 0 && (
      <div className="flex" style={{ height: deadlineRowH }}>
        {/* Empty sidebar spacer — keeps the marker grid aligned under the date
            columns. The DEADLINES label and Pin button are gone (Pin moved to
            the month bar); this whole strip only renders when something is
            actually pinned, so there's no dead row when it's empty. */}
        <div
          className="sticky left-0 z-[60] shrink-0 border-r border-border bg-bg-elev backdrop-blur"
          data-gantt-sidebar=""
          style={{
            width: "var(--sidebar-w)",
            overflow: "hidden",
            height: deadlineRowH,
          }}
        />
        <div
          className="relative"
          style={{
            height: deadlineRowH,
            width: gridWidth,
            position: "relative",
          }}
        >
          {deadlines.map((d) => {
            const idx = dayISOs.indexOf(d.date);
            if (idx < 0) return null;
            return (
              <DeadlineMarker
                key={d.id}
                deadline={d}
                left={idx * colW}
                top={(pillRow.get(`d:${d.id}`) ?? 0) * pillRowH + 4}
                onDelete={() => onDeleteDeadline(d)}
              />
            );
          })}
          {pinnedItems.map((it) => {
            const date = pinnedDeadlineDates.get(it.id);
            if (!date) return null;
            const idx = dayISOs.indexOf(date);
            if (idx < 0) return null;
            return (
              <PinnedItemMarker
                key={it.id}
                item={it}
                date={date}
                left={idx * colW}
                top={(pillRow.get(`p:${it.id}`) ?? 0) * pillRowH + 2}
                onUnpin={() => onUnpinItem(it.id)}
              />
            );
          })}
        </div>
      </div>
      )}

      {/* Compact chip rail. Replaces the per-item Countdown stack so a
          handful of pinned items doesn't eat half the viewport. */}
      <PinnedChipRail
        pinnedItems={pinnedItems}
        pinnedDeadlineDates={pinnedDeadlineDates}
        gridWidth={gridWidth}
        onUnpin={onUnpinItem}
        onJump={onJumpToPinnedItem}
      />

      {/* Merged day header — weekday label + day number on one row per column,
          à la the calendar (was two stacked bordered rows). */}
      <div className="flex" style={{ height: DATE_ROW_H }}>
        <div
          className={cn(
            "sticky left-0 z-[60] flex items-center border-r border-border bg-bg-elev backdrop-blur",
            sidebarCollapsed ? "justify-center px-0" : "gap-2 px-4",
          )}
          data-gantt-sidebar=""
          style={{
            width: "var(--sidebar-w)",
            overflow: "hidden",
            height: DATE_ROW_H,
          }}
        >
          {/* The first block's header lives here now (hoisted up beside the
              date columns to save a row). Falls back to an empty spacer when
              there's no mergeable first block / in focus mode. The eye + date
              label that used to sit here moved to the month bar. */}
          {!sidebarCollapsed && firstBlockHeader}
          {/* Drag handle on the right edge of the sidebar. Sized to the
              date-row height; hover paints a subtle accent strip. */}
          {!sidebarCollapsed && (
            <div
              onPointerDown={(e) => sidebarDrag.start(e, sidebarW)}
              onPointerMove={sidebarDrag.move}
              onPointerUp={sidebarDrag.end}
              onPointerCancel={sidebarDrag.end}
              title="Drag to resize sidebar"
              className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/40"
            />
          )}
        </div>
        <div className="flex" style={{ height: DATE_ROW_H }}>
          {days.map((d, i) => {
            const iso = dayISOs[i];
            const isFocused = focusedDayISO === iso;
            return (
              <ColumnHeaderCell
                key={i}
                weekday={fmtDay(d)}
                dayDate={d.getDate()}
                width={colW}
                isToday={i === todayIndex}
                isWeekend={d.getDay() === 0 || d.getDay() === 6}
                isFocused={isFocused}
                onResize={(w) => setColW(w)}
                onPick={
                  focusedDayISO ? () => onToggleFocusedDay(iso) : undefined
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * The first block's header, rendered INTO the date-header band (its sidebar
 * cell) instead of as its own row below the date columns — a space-saving
 * move: the first block's dropdown occupies the otherwise-empty sidebar space
 * beside the date columns. Mirrors BlockSection's non-locked header exactly
 * (chevron, icon, name, count, chip toggle, context menu). Consequence the
 * user opted into: the first block's colour band strip isn't shown (the date
 * columns live in that grid space instead). Only used when the first block is
 * an active, non-focus-mode block (BlockSection hides headers in focus mode).
 */
function MergedBlockHeader({
  block,
  itemCount,
  onToggleBlock,
  onEditBlock,
  onDeleteBlock,
  onNewItem,
}: {
  block: Block;
  itemCount: number;
  onToggleBlock: () => void;
  onEditBlock: () => void;
  onDeleteBlock: () => void;
  onNewItem: () => void;
}) {
  const blockMenu = useMenu(() => [
    { label: "New item", onClick: onNewItem, shortcut: "C" },
    { label: "Rename / edit", onClick: onEditBlock },
    { label: block.collapsed ? "Expand" : "Collapse", onClick: onToggleBlock },
    { type: "separator" as const },
    { label: "Delete block", destructive: true, onClick: onDeleteBlock },
  ]);
  return (
    <div
      {...blockMenu}
      className="group flex h-full min-w-0 flex-1 items-center gap-2"
    >
      {block.icon ? (
        <BlockIcon
          name={block.icon}
          size={13}
          color={block.color}
          className="shrink-0"
        />
      ) : (
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: block.color }}
        />
      )}
      <button
        onClick={onToggleBlock}
        onDoubleClick={onEditBlock}
        className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-text"
      >
        {block.name}
      </button>
      {/* Item count hidden per design. */}
      {/* <span className="text-[9px] text-text-dim tabular-nums">{itemCount}</span> */}
      {/* Collapse chevron now sits on the right. */}
      <button onClick={onToggleBlock} className="shrink-0 text-text-muted">
        {block.collapsed ? (
          <ChevronRight width={12} height={12} />
        ) : (
          <ChevronDown width={12} height={12} />
        )}
      </button>
    </div>
  );
}

// ─── Block section ───────────────────────────────────────────────────────
function BlockSection({
  block,
  blockIndex,
  items,
  stepsByItem,
  collapsedItems,
  forceExpanded,
  onToggleItem,
  rowH,
  setRowH,
  chipMode,
  setChipMode,
  days,
  colW,
  rangeStartISO,
  gridWidth,
  freshlyCreatedId,
  onToggleBlock,
  onEditBlock,
  onDeleteBlock,
  onNewItem,
  onEditItem,
  onUpdateItem,
  onResizeItem,
  onAddStep,
  onDeleteItem,
  onUpdateStep,
  onRepeatStep,
  onToggleStepDone,
  onDeleteStep,
  onSwapSteps,
  selection,
  selectedItemIds,
  copiedStepIds,
  onMultiBodyShift,
  onLeftPull,
  onSelectItem,
  onCellPointerDown,
  onClearSelection,
  onRecordCellAnchor,
  onConfirmShiftDeadline,
  flashItemId,
  compactSteps,
  locked = false,
  onActivate,
  hideHeader = false,
}: {
  block: Block;
  /** Position in the ordered block list — drives the alternating band tint. */
  blockIndex: number;
  items: Item[];
  stepsByItem: Map<string, Step[]>;
  collapsedItems: Set<string>;
  /** When true, render every block/item as if expanded — used by day-focus mode. */
  forceExpanded?: boolean;
  onToggleItem: (id: string) => void;
  rowH: number;
  setRowH: (h: number) => void;
  chipMode: ChipMode;
  setChipMode: (m: ChipMode) => void;
  days: Date[];
  colW: number;
  rangeStartISO: string;
  gridWidth: number;
  freshlyCreatedId: string | null;
  onToggleBlock: () => void;
  onEditBlock: () => void;
  onDeleteBlock: () => void;
  onNewItem: (prefill?: { start: string; duration: number }) => void;
  onEditItem: (i: Item) => void;
  onUpdateItem: (id: string, patch: Partial<Item>) => void;
  onResizeItem: (
    i: Item,
    n: number,
    opts?: { alsoSetStartDate?: string },
  ) => void;
  onAddStep: (i: Item) => void;
  onDeleteItem: (i: Item) => void;
  onUpdateStep: (id: string, patch: Partial<Step>) => void;
  onRepeatStep: (source: Step, time: string) => void;
  onToggleStepDone: (s: Step) => void;
  onDeleteStep: (s: Step) => void;
  onSwapSteps: (a: string, b: string) => void;
  selection:
    | {
        kind: "cells";
        itemId: string;
        anchorStepId?: string;
        stepIds: Set<string>;
        includeDeadline?: boolean;
        source?: "timeline" | "sidebar";
      }
    | { kind: "items"; itemIds: Set<string> }
    | null;
  selectedItemIds: ReadonlySet<string>;
  copiedStepIds: Set<string> | null;
  onMultiBodyShift?: (dDays: number) => void;
  onLeftPull: (itemId: string, dStart: number) => void;
  onSelectItem: (itemId: string, mode: "replace" | "extend" | "toggle") => void;
  onCellPointerDown: (
    itemId: string,
    stepId: string,
    e: CellPointerInit,
  ) => void;
  onClearSelection: () => void;
  /** Stamp the anchor cell — called on EVERY plain click into a step
   *  input so a follow-up shift-click paints from this origin. */
  onRecordCellAnchor: (itemId: string, stepId: string) => void;
  /** Returns true if a body-drag move (which shifts the deadline)
   *  should proceed. Silently true when the user previously ticked
   *  "don't ask again". */
  onConfirmShiftDeadline: () => Promise<boolean>;
  flashItemId: string | null;
  /** Compact step rows (drag handle + chip column hidden). Mobile-
   *  only — desktop focus mode still wants the full UI. */
  compactSteps: boolean;
  /** Archived block — render read-only (dimmed, lock pill, no mutating
   *  handlers, no draft-create row). The rows are preserved, not deleted, so
   *  reactivating is always available and always lossless. */
  locked?: boolean;
  /** Re-activate this archived block. */
  onActivate?: () => void;
  /** Suppress this block's own header row — used for the first block, whose
   *  header is hoisted into the date-header band (see MergedBlockHeader). */
  hideHeader?: boolean;
}) {
  // In day-focus mode, render every block as expanded regardless of its
  // persisted state — the user wants today's items visible.
  const effectivelyCollapsed = forceExpanded ? false : block.collapsed;
  const blockMenu = useMenu(() => [
    { label: "New item", onClick: () => onNewItem(), shortcut: "C" },
    // Icon is now set inline inside the edit-block dialog, so there's no
    // separate "Set icon…" entry here.
    { label: "Rename / edit", onClick: onEditBlock },
    { label: block.collapsed ? "Expand" : "Collapse", onClick: onToggleBlock },
    { type: "separator" as const },
    { label: "Delete block", destructive: true, onClick: onDeleteBlock },
  ]);

  // Timeline band background for the block header extension. A solid per-block
  // colour wash (replaces the old diagonal hatch), over an alternating neutral
  // tint on every other block so same-hued blocks stay separable.
  // Block band look — switch this to try the different options:
  //   "topfade"   – full colour at top, fades out to the row bg by 50% height
  //   "hatch"     – low-opacity diagonal crosshatch (-45°), tinted
  //   "wash-low"  – flat 4% colour wash
  //   "wash-high" – flat 11% colour wash
  const BAND_STYLE = "hatch" as
    | "topfade"
    | "hatch"
    | "wash-low"
    | "wash-high";
  const bandImage = (() => {
    switch (BAND_STYLE) {
      case "topfade":
        return `linear-gradient(to bottom, ${block.color} 0%, transparent 50%)`;
      case "hatch":
        // Single-direction diagonal lines (/////).
        return `repeating-linear-gradient(45deg, color-mix(in srgb, ${block.color} 28%, transparent) 0px, color-mix(in srgb, ${block.color} 28%, transparent) 2px, transparent 2px, transparent 8px)`;
      case "wash-low":
        return `linear-gradient(0deg, color-mix(in srgb, ${block.color} 7%, transparent), color-mix(in srgb, ${block.color} 7%, transparent))`;
      case "wash-high":
        return `linear-gradient(0deg, color-mix(in srgb, ${block.color} 11%, transparent), color-mix(in srgb, ${block.color} 11%, transparent))`;
    }
  })();
  const bandBg: React.CSSProperties = {
    // Pure surface colour — no alternating grey tint between blocks.
    backgroundColor: "var(--bg-elev)",
    backgroundImage: bandImage,
  };

  // In focus mode (and on mobile, which auto-focuses), hide the block
  // header entirely — the items below carry the visual weight, and the
  // header just steals vertical space on a phone-sized screen.
  return (
    <section
      // Archived blocks read as preserved-but-inactive: dim the whole
      // section. The body is also made non-interactive below.
      className={locked ? "opacity-60" : undefined}
      // Lets the board's scroll tracker know which block section sits under
      // the sticky header (drives the pinned block-header slot). Only active
      // user blocks participate — system/archived sections never own the slot.
      data-block-section={!locked && !block.is_system ? block.id : undefined}
    >
      {!forceExpanded && !hideHeader && locked && (
        // Read-only header for archived blocks: no context menu, no
        // chip-toggle, a lock pill + "Reactivate" instead of editing.
        <div
          className="flex items-stretch border-b border-border bg-bg-elev"
          style={{
            height: BLOCK_HEADER_H,
            width: `calc(var(--sidebar-w) + ${gridWidth}px)`,
          }}
        >
          <div
            className="sticky left-0 z-50 flex h-full items-center gap-2 bg-bg-elev px-4"
            data-gantt-sidebar=""
            style={{
              width: "var(--sidebar-w)",
              overflow: "hidden",
              borderRight: "1px solid var(--border)",
            }}
          >
            <button onClick={onToggleBlock} className="text-text-muted">
              {effectivelyCollapsed ? (
                <ChevronRight width={12} height={12} />
              ) : (
                <ChevronDown width={12} height={12} />
              )}
            </button>
            {block.icon ? (
              <BlockIcon
                name={block.icon}
                size={13}
                color={block.color}
                className="shrink-0 grayscale"
              />
            ) : (
              <span
                className="h-2.5 w-2.5 rounded-full opacity-50"
                style={{ background: block.color }}
              />
            )}
            <span className="flex-1 truncate text-[13px] font-semibold text-text-muted">
              {block.name}
            </span>
            {/* Lock pill — signals "preserved, read-only". */}
            <span className="flex items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 text-[8.1px] font-medium uppercase tracking-wide text-text-dim">
              <svg
                width={8}
                height={8}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Archived
            </span>
            {onActivate && (
              <button
                onClick={onActivate}
                className="rounded-md px-2 py-0.5 text-[9px] font-medium text-accent transition hover:bg-accent/10"
                title="Reactivate this board"
              >
                Reactivate
              </button>
            )}
          </div>
          <div className="flex-1" aria-hidden style={bandBg} />
        </div>
      )}
      {!forceExpanded && !hideHeader && !locked && (
        <div
          {...blockMenu}
          className="group flex items-stretch bg-bg-elev"
          style={{
            height: BLOCK_HEADER_H,
            width: `calc(var(--sidebar-w) + ${gridWidth}px)`,
          }}
        >
          <div
            className="sticky left-0 z-50 flex h-full items-center gap-2 bg-bg-elev px-4"
            data-gantt-sidebar=""
            style={{
              width: "var(--sidebar-w)",
              overflow: "hidden",
              borderRight: "1px solid var(--border)",
            }}
          >
            {block.icon ? (
              <BlockIcon
                name={block.icon}
                size={13}
                color={block.color}
                className="shrink-0"
              />
            ) : (
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: block.color }}
              />
            )}
            <button
              onClick={onToggleBlock}
              onDoubleClick={onEditBlock}
              className="flex-1 text-left text-[13px] font-semibold text-text"
            >
              {block.name}
            </button>
            {/* Item count hidden per design. */}
            {/* <span className="text-[9px] text-text-dim tabular-nums">
              {items.length}
            </span> */}
            {/* Collapse chevron now sits on the right. */}
            <button onClick={onToggleBlock} className="shrink-0 text-text-muted">
              {effectivelyCollapsed ? (
                <ChevronRight width={12} height={12} />
              ) : (
                <ChevronDown width={12} height={12} />
              )}
            </button>
          </div>
          {/* Timeline extension: a per-block colour wash over an alternating
              neutral tint (see bandBg) — replaces the old diagonal hatch. */}
          <div className="flex-1" aria-hidden style={bandBg} />
        </div>
      )}

      {effectivelyCollapsed && items.length > 0 && (
        <div className={locked ? "pointer-events-none" : undefined}>
          <CollapsedBarsSummary
            items={items}
            block={block}
            stepsByItem={stepsByItem}
            days={days}
            colW={colW}
            rangeStartISO={rangeStartISO}
            gridWidth={gridWidth}
            onEditItem={onEditItem}
            selectedItemIds={selectedItemIds}
            onSelectItem={onSelectItem}
          />
        </div>
      )}

      {!effectivelyCollapsed && (
        // Archived blocks render their items read-only: pointer-events-none
        // disables every click/drag/input inside, so none of the mutating
        // handlers below can fire — the data is shown but immutable until the
        // block is reactivated. The Reactivate button lives in the (separate,
        // still-interactive) header above.
        <div className={locked ? "pointer-events-none" : undefined}>
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <ItemSection
                  block={block}
                  item={item}
                  steps={stepsByItem.get(item.id) ?? []}
                  collapsed={!forceExpanded && collapsedItems.has(item.id)}
                  onToggleCollapsed={() => onToggleItem(item.id)}
                  rowH={rowH}
                  setRowH={setRowH}
                  chipMode={chipMode}
                  days={days}
                  colW={colW}
                  rangeStartISO={rangeStartISO}
                  gridWidth={gridWidth}
                  isFreshlyCreated={freshlyCreatedId === item.id}
                  onEdit={() => onEditItem(item)}
                  onUpdateItem={(patch) => onUpdateItem(item.id, patch)}
                  onResize={(n, opts) => onResizeItem(item, n, opts)}
                  onAddStep={() => onAddStep(item)}
                  onDelete={() => onDeleteItem(item)}
                  onUpdateStep={onUpdateStep}
                  onRepeatStep={onRepeatStep}
                  onToggleStepDone={onToggleStepDone}
                  onDeleteStep={onDeleteStep}
                  onSwapSteps={onSwapSteps}
                  selectedStepIds={(() => {
                    if (!selection) return null;
                    if (
                      selection.kind === "cells" &&
                      selection.itemId === item.id
                    )
                      return selection.stepIds;
                    if (
                      selection.kind === "items" &&
                      selection.itemIds.has(item.id)
                    )
                      return new Set(
                        (stepsByItem.get(item.id) ?? []).map((s) => s.id),
                      );
                    return null;
                  })()}
                  selectionSource={
                    selection?.kind === "cells"
                      ? (selection.source ?? "timeline")
                      : "timeline"
                  }
                  copiedStepIds={copiedStepIds}
                  isDeadlineSelected={
                    !!selection &&
                    ((selection.kind === "cells" &&
                      selection.itemId === item.id &&
                      !!selection.includeDeadline) ||
                      (selection.kind === "items" &&
                        selection.itemIds.has(item.id)))
                  }
                  isItemBarSelected={
                    !!selection &&
                    selection.kind === "items" &&
                    selection.itemIds.has(item.id)
                  }
                  onMultiBodyShift={onMultiBodyShift}
                  onLeftPull={onLeftPull}
                  onSelectItem={onSelectItem}
                  onCellPointerDown={onCellPointerDown}
                  onClearSelection={onClearSelection}
                  onRecordCellAnchor={onRecordCellAnchor}
                  onConfirmShiftDeadline={onConfirmShiftDeadline}
                  isFlashing={flashItemId === item.id}
                  // Compact = mobile only. Desktop focus mode keeps
                  // the drag handle + chip column visible because the
                  // sidebar is wide enough and the user still wants
                  // to edit time/effort while focused.
                  compact={compactSteps}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* In focus mode the block header is hidden, so a trailing
           *  "+ New item" row inside each block would orphan visually —
           *  skip it. Archived (locked) blocks never get a create row
           *  either — they're read-only. The desktop top-bar "+ New item"
           *  button still works for adding items in focus mode. */}
          {!forceExpanded && !locked && (
            <DraftCreateRow
              days={days}
              colW={colW}
              gridWidth={gridWidth}
              color={block.color}
              onCreate={(start, duration) => onNewItem({ start, duration })}
              onClickNew={() => {
                // Place the new task right after the last visible step in
                // this block, not at today — avoids a gap when items are old.
                let maxCol = -1;
                for (const it of items) {
                  for (const s of stepsByItem.get(it.id) ?? []) {
                    if (s.status === "done") continue;
                    const col =
                      daysBetween(rangeStartISO, it.start_date) + s.day_offset;
                    if (col > maxCol) maxCol = col;
                  }
                }
                const smartStart =
                  maxCol >= 0
                    ? toISODate(
                        addDays(new Date(rangeStartISO + "T00:00:00"), maxCol + 1),
                      )
                    : toISODate(new Date());
                onNewItem({ start: smartStart, duration: 1 });
              }}
            />
          )}
        </div>
      )}
      <div style={{ height: 4 }} />
    </section>
  );
}

// ─── Item section ────────────────────────────────────────────────────────
function ItemSection({
  block,
  item,
  steps,
  collapsed,
  onToggleCollapsed,
  rowH,
  setRowH,
  chipMode,
  days,
  colW,
  rangeStartISO,
  gridWidth,
  isFreshlyCreated,
  onEdit,
  onUpdateItem,
  onResize,
  onAddStep,
  onDelete,
  onUpdateStep,
  onRepeatStep,
  onToggleStepDone,
  onDeleteStep,
  onSwapSteps,
  selectedStepIds,
  selectionSource,
  copiedStepIds,
  isDeadlineSelected,
  isItemBarSelected,
  onMultiBodyShift,
  onLeftPull,
  onSelectItem,
  onCellPointerDown,
  onClearSelection,
  onRecordCellAnchor,
  onConfirmShiftDeadline,
  isFlashing,
  compact = false,
}: {
  block: Block;
  item: Item;
  steps: Step[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  rowH: number;
  setRowH: (h: number) => void;
  chipMode: ChipMode;
  /** Compact mode: forwarded to each StepRow. */
  compact?: boolean;
  /** Where the click originated — drives mutually-exclusive
   *  selection visuals between timeline cell and sidebar row. */
  selectionSource: "timeline" | "sidebar";
  copiedStepIds: Set<string> | null;
  days: Date[];
  colW: number;
  rangeStartISO: string;
  gridWidth: number;
  isFreshlyCreated: boolean;
  onEdit: () => void;
  onUpdateItem: (patch: Partial<Item>) => void;
  onResize: (n: number, opts?: { alsoSetStartDate?: string }) => void;
  onAddStep: () => void;
  onDelete: () => void;
  onUpdateStep: (id: string, patch: Partial<Step>) => void;
  onRepeatStep: (source: Step, time: string) => void;
  onToggleStepDone: (s: Step) => void;
  onDeleteStep: (s: Step) => void;
  onSwapSteps: (a: string, b: string) => void;
  selectedStepIds: Set<string> | null;
  isDeadlineSelected: boolean;
  isItemBarSelected: boolean;
  onMultiBodyShift?: (dDays: number) => void;
  onLeftPull: (itemId: string, dStart: number) => void;
  onSelectItem: (itemId: string, mode: "replace" | "extend" | "toggle") => void;
  onCellPointerDown: (
    itemId: string,
    stepId: string,
    e: CellPointerInit,
  ) => void;
  onClearSelection: () => void;
  onRecordCellAnchor: (itemId: string, stepId: string) => void;
  onConfirmShiftDeadline: () => Promise<boolean>;
  /** When true, paint a 2-pulse green overlay (search jump affordance). */
  isFlashing: boolean;
}) {
  const color = item.color ?? block.color;

  const dialogs = useDialogs();
  const edit = useBoardEdit();

  // Deadline drag-to-move. Owned at the item level so every step row's deadline
  // pill follows the same delta together; commit reuses the arrow-key shift.
  const deadlineDragRef = useRef<{ originX: number; delta: number } | null>(
    null,
  );
  const [deadlineDragDelta, setDeadlineDragDelta] = useState(0);
  const onDeadlinePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    deadlineDragRef.current = { originX: e.clientX, delta: 0 };
    setDeadlineDragDelta(0);
  }, []);
  const onDeadlinePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = deadlineDragRef.current;
      if (!d) return;
      const delta = Math.round((e.clientX - d.originX) / colW);
      d.delta = delta;
      setDeadlineDragDelta(delta);
    },
    [colW],
  );
  const onDeadlinePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = deadlineDragRef.current;
      if (!d) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      const delta = d.delta;
      deadlineDragRef.current = null;
      setDeadlineDragDelta(0);
      if (delta !== 0) edit.moveDeadline(item.id, delta);
    },
    [edit.moveDeadline, item.id],
  );

  // Hide done steps from the staircase (they appear in Completed block).
  // Within a single day, timed cells render above untimed ("TBD") ones,
  // earliest time first — so when a forward drag stacks cells onto one column
  // the scheduled cell sits on top. Across days the order is still by day.
  const visibleSteps = useMemo(
    () =>
      steps
        .filter((s) => s.status !== "done")
        .sort((x, y) => {
          if (x.day_offset !== y.day_offset) return x.day_offset - y.day_offset;
          const xt = x.time_of_day;
          const yt = y.time_of_day;
          if (xt && yt) return xt < yt ? -1 : xt > yt ? 1 : 0;
          if (xt) return -1;
          if (yt) return 1;
          return 0;
        }),
    [steps],
  );

  // For long tasks, cap the sidebar to 5 rows and ghost the rest of the bar.
  const STEP_PREVIEW_LIMIT = 5;
  const [showAllSteps, setShowAllSteps] = useState(false);
  // Reset the "show all" expansion whenever the item is collapsed so
  // re-expanding always starts fresh at the 5-step preview.
  useEffect(() => {
    if (collapsed) setShowAllSteps(false);
  }, [collapsed]);
  const isCapped =
    !collapsed && !showAllSteps && visibleSteps.length > STEP_PREVIEW_LIMIT;
  const renderedSteps = isCapped
    ? visibleSteps.slice(0, STEP_PREVIEW_LIMIT)
    : visibleSteps;
  const hiddenStepCount = visibleSteps.length - STEP_PREVIEW_LIMIT;

  const undoneOffsets = visibleSteps.map((s) => s.day_offset);
  const barStartOffset = undoneOffsets.length ? Math.min(...undoneOffsets) : 0;
  const barEndOffset = undoneOffsets.length
    ? Math.max(...undoneOffsets)
    : item.duration_days - 1;
  // Effective deadline: floor is the last UNDONE step's offset. Done steps
  // don't count — they're finished and shouldn't hold the deadline forward.
  const deadlineOffset = effectiveDeadlineOffset(
    item.deadline_offset,
    undoneOffsets,
  );

  // Drag state
  const dragRef = useRef<{
    mode: "body" | "left" | "right";
    originX: number;
    originStart: string;
    originDuration: number;
  } | null>(null);
  const [dragDeltaStart, setDragDeltaStart] = useState(0);
  const [dragDeltaDuration, setDragDeltaDuration] = useState(0);

  function startDrag(mode: "body" | "left" | "right", e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      originX: e.clientX,
      originStart: item.start_date,
      originDuration: item.duration_days,
    };
    setDragDeltaStart(0);
    setDragDeltaDuration(0);
  }
  function moveDrag(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const delta = Math.round((e.clientX - dragRef.current.originX) / colW);
    let nextStart = 0;
    let nextDur = 0;
    if (dragRef.current.mode === "body") {
      nextStart = delta;
    } else if (dragRef.current.mode === "left") {
      const maxDelta = dragRef.current.originDuration - 1;
      const clamped = Math.min(maxDelta, delta);
      nextStart = clamped;
      nextDur = -clamped;
    } else {
      const minDelta = 1 - dragRef.current.originDuration;
      nextDur = Math.max(minDelta, delta);
    }
    setDragDeltaStart(nextStart);
    setDragDeltaDuration(nextDur);
  }
  function endDrag(e: React.PointerEvent) {
    if (!dragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const { mode, originStart, originDuration } = dragRef.current;
    const dStart = dragDeltaStart;
    const dDur = dragDeltaDuration;
    dragRef.current = null;
    setDragDeltaStart(0);
    setDragDeltaDuration(0);
    if (dStart === 0 && dDur === 0) return;
    if (mode === "body" && dStart !== 0) {
      if (dStart < 0) {
        // Moving the bar BACK (earlier) keeps the deadline fixed — compensate
        // its offset so the date doesn't move. The cells ride back with the bar;
        // no confirmation, since the deadline isn't shifting.
        if (isItemBarSelected && onMultiBodyShift) {
          onMultiBodyShift(dStart);
        } else {
          onUpdateItem({
            start_date: isoAtOffset(originStart, dStart),
            deadline_offset: Math.min(3650, deadlineOffset - dStart),
          });
        }
      } else {
        // Moving the bar FORWARD shifts the deadline with it (it's anchored to
        // start_date). Always confirm (per-day "don't show again"); the TBD
        // cells just ride along — no stacking.
        void (async () => {
          const ok = await onConfirmShiftDeadline();
          if (!ok) return;
          if (isItemBarSelected && onMultiBodyShift) {
            onMultiBodyShift(dStart);
          } else {
            onUpdateItem({ start_date: isoAtOffset(originStart, dStart) });
          }
        })();
      }
    } else if (mode === "left") {
      // Resizing from the left edge keeps the deadline fixed: pushing the edge
      // in (later) stacks the cells toward the deadline; pulling it back
      // (earlier) un-stacks them into the staircase, adding new TBD cells once
      // it's full.
      onLeftPull(item.id, dStart);
    } else if (mode === "right" && dDur !== 0) {
      onResize(originDuration + dDur);
    }
  }

  const itemStartIdx =
    daysBetween(rangeStartISO, item.start_date) + dragDeltaStart;
  const barStartIdx = itemStartIdx + barStartOffset;
  const barEndIdx = itemStartIdx + barEndOffset + dragDeltaDuration;
  const visibleStart = Math.max(0, barStartIdx);
  const visibleEnd = Math.min(days.length - 1, barEndIdx);
  const inRange = visibleEnd >= 0 && visibleStart <= days.length - 1;
  const barLeft = inRange ? visibleStart * colW : 0;
  const barWidth = inRange ? (visibleEnd - visibleStart + 1) * colW : 0;

  // When capped, split the bar: solid for the first STEP_PREVIEW_LIMIT
  // columns, ghost (translucent) for the rest.
  const cutoffStep = isCapped ? visibleSteps[STEP_PREVIEW_LIMIT - 1] : null;
  const cutoffCol = cutoffStep
    ? Math.min(days.length - 1, itemStartIdx + cutoffStep.day_offset)
    : visibleEnd;
  const solidWidth = inRange ? (cutoffCol - visibleStart + 1) * colW : barWidth;
  const ghostLeft = barLeft + solidWidth;
  const ghostWidth = inRange && isCapped ? (visibleEnd - cutoffCol) * colW : 0;

  const menu = useMenu(() => [
    { label: "Edit item", onClick: onEdit },
    {
      label: collapsed ? "Expand steps" : "Collapse steps",
      onClick: onToggleCollapsed,
    },
    { label: "Add a day", onClick: onAddStep },
    {
      label: "Remove last day",
      onClick: () => onResize(Math.max(1, item.duration_days - 1)),
      disabled: item.duration_days <= 1,
    },
    {
      label: "Fill all days with same label…",
      onClick: async () => {
        const label = await dialogs.prompt({
          title: `Same label for every day of "${item.title}"`,
          label: "Label",
          placeholder: "e.g. Practice questions",
          initialValue: steps[0]?.label ?? "",
          confirmLabel: "Apply",
        });
        if (label === null) return;
        for (const s of steps) {
          if (s.label !== label) onUpdateStep(s.id, { label });
        }
      },
    },
    { type: "separator" },
    { label: "Delete item", destructive: true, onClick: onDelete },
  ]);

  const allDone = steps.length > 0 && steps.every((s) => s.status === "done");
  const isDark = useIsDarkTheme();

  // Snapshot freshness at mount so re-renders don't tear the cascade.
  const wasFresh = useRef(isFreshlyCreated);

  // Auto-focus first step input when item was freshly created.
  // Nav between inputs is done globally via navigateInputs (DOM query).
  useEffect(() => {
    if (!wasFresh.current) return;
    if (visibleSteps.length === 0) return;
    const first = visibleSteps[0];
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(
        `[data-nav-col="label"][data-nav-row="${first.id}"]`,
      );
      if (el) {
        el.focus();
        el.select();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-item-row={item.id}>
      {/* Item header */}
      <div
        {...menu}
        className="group relative flex items-stretch"
        style={{
          height: ITEM_HEADER_H,
          width: `calc(var(--sidebar-w) + ${gridWidth}px)`,
        }}
      >
        <div
          className="sticky left-0 z-50 flex h-full items-center gap-2 bg-bg pl-4 pr-4"
          data-gantt-sidebar=""
          style={{
            width: "var(--sidebar-w)",
            overflow: "hidden",
            borderRight: "1px solid var(--border)",
          }}
        >
          {/* Plus (add day) on the far left, then the title, then the
           *  collapse chevron on the far right. The colour pill was removed. */}
          <button
            onClick={() => {
              // Goes through the board-level onAddStep, which knows the
              // full step list (including hidden/focus-mode-filtered ones)
              // and inserts at max(offset)+1 — no shrink prompts, no
              // duplicate offsets.
              onAddStep();
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  const inputs = document.querySelectorAll<HTMLInputElement>(
                    `[data-step-label="${item.id}"]`,
                  );
                  const last = inputs[inputs.length - 1];
                  if (last) {
                    last.focus();
                    last.select();
                  }
                });
              });
            }}
            title={`Add a day (${steps.length} day${steps.length === 1 ? "" : "s"})`}
            // Shaped like the step checkboxes (15px, rounded-md): a SOLID
            // block-colour fill with an 80%-white glyph so it reads as a
            // lighter mark on the block colour.
            className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-md transition hover:[filter:saturate(1.7)]"
            style={{
              background: color,
              color: "rgba(255,255,255,0.8)",
            }}
          >
            <Plus width={11} height={11} strokeWidth={2.8} />
          </button>
          <button
            onClick={onEdit}
            className={cn(
              "flex-1 truncate text-left text-[11.7px] font-semibold",
              allDone ? "text-text-dim line-through" : "text-text",
            )}
          >
            {item.title}
          </button>
          <button
            onClick={onToggleCollapsed}
            className="shrink-0 text-text-muted transition hover:text-text"
            title={collapsed ? "Expand steps" : "Collapse steps"}
          >
            {collapsed ? (
              <ChevronRight width={12} height={12} />
            ) : (
              <ChevronDown width={12} height={12} />
            )}
          </button>
        </div>
        <div className="relative flex-1">
          {inRange && ghostWidth > 0 && (
            <div
              className="absolute top-1/2 -translate-y-1/2 flex items-center overflow-hidden rounded-md px-2.5"
              style={{
                left: ghostLeft,
                width: ghostWidth,
                height: Math.max(14, rowH - 8),
                background: `color-mix(in srgb, ${color} 22%, var(--bg-elev))`,
              }}
              onClick={() => setShowAllSteps(true)}
            >
              <span
                className="truncate text-[9.9px] font-medium"
                style={{
                  color: `color-mix(in srgb, ${color} 58%, ${isDark ? "white" : "black"})`,
                }}
              >
                {hiddenStepCount} step{hiddenStepCount === 1 ? "" : "s"} hidden
              </span>
            </div>
          )}
          {inRange && (
            <div
              className="absolute top-1/2 -translate-y-1/2"
              style={{
                left: barLeft,
                width: solidWidth,
                height: Math.max(14, rowH - 8),
              }}
            >
              <div className="relative h-full">
                <div
                  onPointerDown={(e) => startDrag("left", e)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className="absolute left-0 top-0 z-20 h-full w-1.5 cursor-ew-resize hover:bg-white/30"
                  title="Drag to shift start"
                />
                <div
                  data-cell-item-bar={item.id}
                  data-cell-item-id={item.id}
                  onPointerDown={(e) => {
                    // Modifier-click selects/toggles instead of starting a
                    // drag — same contract as cell modifier-clicks.
                    if (
                      e.button === 0 &&
                      (e.shiftKey || e.metaKey || e.ctrlKey)
                    ) {
                      e.stopPropagation();
                      e.preventDefault();
                      const mode = e.shiftKey
                        ? "extend"
                        : e.metaKey || e.ctrlKey
                          ? "toggle"
                          : "replace";
                      onSelectItem(item.id, mode);
                      return;
                    }
                    startDrag("body", e);
                  }}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onDoubleClick={onEdit}
                  className={cn(
                    "absolute inset-x-[3px] flex h-full items-center overflow-hidden rounded-md px-2.5 transition hover:brightness-110",
                    "cursor-grab active:cursor-grabbing",
                    isItemBarSelected &&
                      "ring-2 ring-accent ring-offset-1 ring-offset-bg",
                  )}
                  style={{
                    // Solid slab (title always legible in both themes). Progress
                    // is a thin sub-track below, not a two-tone fill — a fill
                    // split made the remainder near-white in light mode and hid
                    // the white title. Done collapses to the flat done tint.
                    background: allDone
                      ? `color-mix(in srgb, ${color} 10%, var(--bg-elev))`
                      : color,
                    transition: "background-color 0.5s ease, color 0.5s ease",
                    ...(isItemBarSelected ? { zIndex: 30 } : null),
                  }}
                >
                  <span
                    className={cn(
                      "truncate text-[10.8px] font-semibold",
                      allDone && "line-through",
                    )}
                    style={{
                      // Full white on the solid bar in BOTH themes. The old
                      // dark-mode tint (color-mix 35% block colour into white)
                      // read as "text didn't turn white" on saturated blocks.
                      color: allDone
                        ? "color-mix(in srgb, var(--text) 45%, transparent)"
                        : "#fff",
                    }}
                  >
                    {item.title}
                  </span>
                </div>
                <div
                  onPointerDown={(e) => startDrag("right", e)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-ew-resize hover:bg-white/30"
                  title="Drag to resize"
                />
              </div>
            </div>
          )}
        </div>
        {isFlashing && (
          <div
            data-search-flash=""
            className="pointer-events-none absolute inset-0 z-[1]"
            aria-hidden
          />
        )}
      </div>

      {/* Step rows */}
      {!collapsed && (
        <motion.div
          initial={wasFresh.current ? "hidden" : false}
          animate="visible"
          variants={stepContainerVariants}
        >
          {renderedSteps.map((step, idx) => {
            // Prev/next adjacency in selection / copied set — drives
            // edge-aware borders so a block of selected rows reads as
            // one unified outline instead of three stacked rings.
            const prev = renderedSteps[idx - 1];
            const next = renderedSteps[idx + 1];
            const sel = selectedStepIds;
            const cop = copiedStepIds;
            const isSel = sel?.has(step.id) ?? false;
            const isCop = cop?.has(step.id) ?? false;
            return (
              <motion.div
                key={step.id}
                variants={stepRowVariants}
                initial={wasFresh.current ? "hidden" : false}
                animate="visible"
                layout
              >
                <StepRow
                  step={step}
                  item={item}
                  color={color}
                  days={days}
                  colW={colW}
                  rangeStartISO={rangeStartISO}
                  gridWidth={gridWidth}
                  rowH={rowH}
                  setRowH={setRowH}
                  chipMode={chipMode}
                  compact={compact}
                  isSelected={isSel}
                  selectionSource={selectionSource}
                  isCopied={isCop}
                  isPrevSelected={!!prev && (sel?.has(prev.id) ?? false)}
                  isNextSelected={!!next && (sel?.has(next.id) ?? false)}
                  isPrevCopied={!!prev && (cop?.has(prev.id) ?? false)}
                  isNextCopied={!!next && (cop?.has(next.id) ?? false)}
                  deadlineOffset={deadlineOffset}
                  isDeadlineSelected={isDeadlineSelected}
                  onCellPointerDown={onCellPointerDown}
                  onClearSelection={onClearSelection}
                  onRecordCellAnchor={onRecordCellAnchor}
                  onUpdateStep={onUpdateStep}
                  onRepeatStep={onRepeatStep}
                  onToggleStepDone={onToggleStepDone}
                  onDeleteStep={onDeleteStep}
                  onSwapSteps={onSwapSteps}
                  deadlineDragDelta={deadlineDragDelta}
                  onDeadlinePointerDown={onDeadlinePointerDown}
                  onDeadlinePointerMove={onDeadlinePointerMove}
                  onDeadlinePointerUp={onDeadlinePointerUp}
                />
              </motion.div>
            );
          })}
          {isCapped && (
            <button
              onClick={() => setShowAllSteps(true)}
              className="sticky left-0 z-50 flex items-center gap-1.5 bg-bg px-4 py-1.5 text-[10.3px] text-text-muted transition hover:text-text"
              style={{
                width: "var(--sidebar-w)",
                borderRight: "1px solid var(--border)",
              }}
            >
              <ChevronDown width={11} height={11} />
              Show {hiddenStepCount} more step{hiddenStepCount === 1 ? "" : "s"}
            </button>
          )}
          {showAllSteps && visibleSteps.length > STEP_PREVIEW_LIMIT && (
            <button
              onClick={() => setShowAllSteps(false)}
              className="sticky left-0 z-50 flex items-center gap-1.5 bg-bg px-4 py-1.5 text-[10.3px] text-text-muted transition hover:text-text"
              style={{
                width: "var(--sidebar-w)",
                borderRight: "1px solid var(--border)",
              }}
            >
              <ChevronUp width={11} height={11} />
              Show less
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ─── Draft create row ────────────────────────────────────────────────────
function DraftCreateRow({
  days,
  colW,
  gridWidth,
  color,
  onCreate,
  onClickNew,
}: {
  days: Date[];
  colW: number;
  gridWidth: number;
  /** Block colour — the "+ New item" label/icon inherit it. */
  color: string;
  onCreate: (start: string, duration: number) => void;
  onClickNew: () => void;
}) {
  const [drag, setDrag] = useState<{ startIdx: number; endIdx: number } | null>(
    null,
  );
  const rowRef = useRef<HTMLDivElement>(null);

  function idxAt(clientX: number): number | null {
    if (!rowRef.current) return null;
    const r = rowRef.current.getBoundingClientRect();
    const x = clientX - r.left;
    const idx = Math.floor(x / colW);
    if (idx < 0 || idx >= days.length) return null;
    return idx;
  }

  function start(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const i = idxAt(e.clientX);
    if (i == null) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ startIdx: i, endIdx: i });
  }
  function move(e: React.PointerEvent) {
    if (!drag) return;
    const i = idxAt(e.clientX);
    if (i == null) return;
    setDrag({ ...drag, endIdx: i });
  }
  function end(e: React.PointerEvent) {
    if (!drag) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const a = Math.min(drag.startIdx, drag.endIdx);
    const b = Math.max(drag.startIdx, drag.endIdx);
    const start = days[a];
    const duration = b - a + 1;
    setDrag(null);
    onCreate(toISODate(start), duration);
  }

  const ghost = drag
    ? (() => {
        const a = Math.min(drag.startIdx, drag.endIdx);
        const b = Math.max(drag.startIdx, drag.endIdx);
        return { left: a * colW, width: (b - a + 1) * colW, count: b - a + 1 };
      })()
    : null;

  return (
    <div
      className="group flex items-stretch"
      style={{ height: 28, width: `calc(var(--sidebar-w) + ${gridWidth}px)` }}
    >
      <button
        onClick={onClickNew}
        className="sticky left-0 z-50 flex h-full items-center gap-2 bg-bg pl-6 pr-3 text-[10.3px] transition hover:brightness-110"
        data-gantt-sidebar=""
        style={{
          width: "var(--sidebar-w)",
          overflow: "hidden",
          borderRight: "1px solid var(--border)",
          color,
        }}
        title="Click for modal, or drag across days →"
      >
        <Plus width={11} height={11} />
        <span>New item</span>
      </button>
      <div
        ref={rowRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={(e) => {
          (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
          setDrag(null);
        }}
        className="relative flex-1 cursor-crosshair"
      >
        {ghost && (
          <div
            className="absolute top-1/2 -translate-y-1/2 rounded-md border border-accent bg-accent/20"
            style={{ left: ghost.left, width: ghost.width, height: 18 }}
          >
            <span className="absolute -top-5 left-0 rounded bg-accent px-1.5 py-0.5 text-[9px] font-medium text-white">
              {ghost.count} day{ghost.count === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
