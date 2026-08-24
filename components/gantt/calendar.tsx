"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  addDays,
  buildDateRange,
  cn,
  daysBetween,
  fmtDay,
  fmtFull,
  fmtTime12,
  fmtTimeRange12,
  isToday,
  toISODate,
} from "@/lib/utils";
import { flushSync } from "react-dom";
import { parseISODate } from "@/lib/gantt/layout";
import { useMarquee } from "@/lib/hooks/use-marquee";
import { useViewport } from "@/lib/hooks/use-viewport";
import { BlockIcon } from "@/components/modals/block-icon-picker";
import { TimePopover } from "@/components/ui/time-picker";
import type { Block, Item, Step } from "@/lib/types/database";
import type { ResolvedSettings } from "@/lib/types/settings";
import { DEFAULT_SETTINGS } from "@/lib/types/settings";
import { useMenu } from "@/components/ui/context-menu";
import { useDialogs } from "@/components/ui/dialogs";
import { EventEditPopover } from "@/components/ui/event-edit-popover";
import { BlockSelect } from "@/components/ui/block-select";
import {
  layoutOverlaps,
  type OverlapLaidOut,
} from "@/lib/calendar/overlap-layout";
import { useEscape } from "@/lib/hooks/use-escape";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

const TIME_COL_W = 64;
const HEADER_H = 36;
// Google Calendar-style gutter at the right edge of each day column:
// timed cards never reach it, so the grid behind stays visible (and
// clickable for drag-to-create) alongside any event.
const CARD_RIGHT_GUTTER = 10;
const DEFAULT_EVENT_MIN = 30;

type Placed = {
  step: Step;
  item: Item;
  // Narrowed to what the calendar actually renders, so a blockless
  // (calendar-only) item can supply a neutral pseudo-block.
  block: { name: string; color: string; icon: string | null };
  date: string;
  // Whether the step has NO time_of_day and belongs in the TBD shelf. This is
  // the sole untimed signal — kept distinct from startMin so a genuinely-timed
  // event scheduled before START_HOUR (negative offset, clamped to 0 below)
  // still renders on the grid instead of being misread as TBD.
  isTbd: boolean;
  startMin: number; // minutes from START_HOUR; clamped to >=0 for timed steps
  durationMin: number;
};

/** Neutral pseudo-block for calendar-only (blockless) tasks. */
const CALENDAR_ONLY_BLOCK = {
  name: "Calendar",
  color: "#64748b",
  icon: null as string | null,
};

/**
 * How far an hour label overhangs its own gridline, in px.
 *
 * The gutter draws every label but the first at `-top-1.5` — six-ish px above
 * the line it names — so a scroll position that lands exactly on an hour cuts
 * that label in half. Used by the open-at-8AM effect below to park just above
 * the line instead of on it. Two px of slack over the real overhang, matching
 * the `top-0.5` the first label already uses.
 */
const HOUR_LABEL_BLEED = 8;

function parseStartMin(t: string | null, startHour: number): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h * 60 + min - startHour * 60;
}
function minToTime24(min: number, startHour: number): string {
  const total = Math.max(0, min) + startHour * 60;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function snapMinFn(slotMin: number) {
  return (min: number) => Math.round(min / slotMin) * slotMin;
}

// Overlap layout lives in lib/calendar/overlap-layout.ts (pure + unit
// tested). It emits fractional geometry: left/width as 0..1 of the
// gutter-adjusted column, plus depth for z-order and border seams.
type LaidOut = OverlapLaidOut<Placed>;

type DragKind = "timed" | "tbd";
type DragFollower = {
  stepId: string;
  isTbd: boolean;
  date: string;
  startMin: number;
  durationMin: number;
};
type DragState = {
  stepId: string; // primary
  kind: DragKind;
  originDate: string;
  originStartMin: number;
  originDurationMin: number;
  grabOffsetMin: number;
  currentDate: string;
  currentStartMin: number;
  followers: DragFollower[];
};

type SelectMode = "replace" | "extend" | "toggle";

export function CalendarView({
  blocks,
  items,
  steps,
  daysToShow,
  startDate,
  onShiftDays,
  onLivePan,
  settings,
  onUpdateStep,
  onRepeatStep,
  onUpdateItem,
  onDeleteStep,
  onToggleStepDone,
  onPickDay,
  onBackToWeek,
  onCreateTask,
  flashDate,
  headerControls,
  registerBeginDrag,
  onFocusDay,
}: {
  blocks: Block[];
  items: Item[];
  steps: Step[];
  daysToShow: number;
  startDate?: string;
  /** Commit a whole-day horizontal shift from panning the week strip (± days).
   *  Absent → panning is disabled (e.g. day view). */
  onShiftDays?: (deltaDays: number) => void;
  /** LIVE viewport offset (whole days from `startDate`) while panning — fires
   *  the moment the strip crosses a day boundary, before any commit, so the
   *  sidebar mini-month tracks the viewport in real time (à la Notion). Returns
   *  to 0 as the settle commits into `onShiftDays`. */
  onLivePan?: (deltaDays: number) => void;
  settings?: ResolvedSettings;
  onUpdateStep: (id: string, patch: Partial<Step>) => void;
  /** Add another timed occurrence of a step on the same day. */
  onRepeatStep: (source: Step, time: string) => void;
  onUpdateItem?: (id: string, patch: Partial<Item>) => void;
  onDeleteStep: (s: Step) => void;
  onToggleStepDone: (s: Step) => void;
  onPickDay?: (iso: string) => void;
  onBackToWeek?: () => void;
  /** Create a calendar event from a drag (blockId null = calendar-only). */
  onCreateTask?: (input: {
    date: string;
    time: string;
    durationMin: number;
    blockId: string | null;
    title: string;
    /** Weekdays (JS getDay) for a recurring series; null = one-off. */
    recurringDays: number[] | null;
  }) => void;
  /** ISO date that should briefly green-flash (jump affordance). */
  flashDate?: string | null;
  /** Nav/view controls rendered on the right of the month bar (à la Notion). */
  headerControls?: React.ReactNode;
  /** Receives a fn to begin dragging an unscheduled step onto the grid — the
   *  sidebar calls it so the calendar's own ghost/drop machinery takes over. */
  registerBeginDrag?: (
    fn: (stepId: string, occurrenceDate: string, durationMin: number) => void,
  ) => void;
  /** The user focused a day (clicked its column, or dropped a task on it) — the
   *  Unscheduled tray follows this. */
  onFocusDay?: (iso: string) => void;
}) {
  const cfg = settings ?? DEFAULT_SETTINGS;

  // Live theme detection — watches the data-theme attribute on <html>
  // so it updates instantly when the user toggles theme, regardless of
  // whether settings has been saved to DB yet.
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

  const START_HOUR = cfg.calendarStartHour;
  const END_HOUR = cfg.calendarEndHour;
  const HOURS = Math.max(1, END_HOUR - START_HOUR);
  const HOUR_H = cfg.calendarHourHeight;
  const SLOT_MIN = cfg.slotMin;
  const snapMin = snapMinFn(SLOT_MIN);

  const { isMobile } = useViewport();
  // Pending quick-create draft (set by a drag on the empty grid).
  const [draft, setDraft] = useState<{
    date: string;
    startMin: number;
    durationMin: number;
    x: number;
    y: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dayColRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dialogs = useDialogs();

  // ── Selection (spreadsheet-style multi-select) ──────────────────────
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const selectionRef = useRef<Set<string>>(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  function selectStep(id: string, mode: SelectMode) {
    setSelection((prev) => {
      if (mode === "replace") return new Set([id]);
      const n = new Set(prev);
      if (mode === "toggle") {
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }
      // extend = just add
      n.add(id);
      return n;
    });
  }
  function clearSelection() {
    setSelection(new Set());
  }

  // ── Marquee lasso ───────────────────────────────────────────────────
  // Calendar selection is flat: every event card the lasso touches joins
  // the selection.
  const { onPointerDown: onBodyPointerDown, lasso } = useMarquee({
    targetSelector: "[data-cal-card]",
    ignoreSelector: "[data-cal-card]",
    onIntersect: (matched) => {
      const next = new Set<string>();
      for (const el of matched) {
        const id = el.dataset.calCard;
        if (id) next.add(id);
      }
      setSelection(next);
    },
  });

  // Esc clears selection
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const editing =
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable;
      if (editing) return;
      if (e.key === "Escape" && selectionRef.current.size > 0) {
        e.preventDefault();
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const effectiveStart = useMemo(() => {
    if (startDate) return parseISODate(startDate);
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, [startDate]);

  // Draggable weeks (à la Notion): the strip can pan horizontally and snaps to
  // whole-day columns. We render a buffer of `daysToShow` extra columns on each
  // side so a pan (capped at one week per gesture) never reveals empty space,
  // then translate the strip and commit whole-day shifts to the parent on
  // settle. Disabled in day view / mobile / when the parent can't accept shifts.
  const panEnabled = !!onShiftDays && !isMobile && daysToShow > 1;
  // Render buffer: TWO weeks of extra columns each side. Commits happen ONLY
  // when the strip is at rest — never mid-gesture (a mid-gesture re-render is
  // unavoidable jitter) — so the buffer must hold a full capped swipe (7) plus
  // a compound swipe riding on it before the first one's commit (≤7 more).
  const BUFFER = panEnabled ? daysToShow * 2 : 0;
  // Per-swipe travel cap: one swipe moves at most one week.
  const SWIPE_CAP = daysToShow;

  // The daysToShow window actually "in view" (drives the month label & logic).
  const visibleDays = useMemo(
    () => buildDateRange(effectiveStart, daysToShow),
    [effectiveStart, daysToShow],
  );
  // Everything rendered in the strip — the visible window plus the buffer.
  const days = useMemo(
    () =>
      panEnabled
        ? buildDateRange(addDays(effectiveStart, -BUFFER), daysToShow + 2 * BUFFER)
        : visibleDays,
    [panEnabled, effectiveStart, BUFFER, daysToShow, visibleDays],
  );

  // "July 2026" for the visible range — the middle day so a week that straddles
  // two months shows its dominant one, matching how calendars label the week.
  const monthYearLabel = useMemo(() => {
    const mid = visibleDays[Math.floor(visibleDays.length / 2)] ?? visibleDays[0];
    return mid
      ? mid.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : "";
  }, [visibleDays]);

  // ── Week panning: NATIVE horizontal scroll + CSS scroll-snap ────────
  // How Notion Calendar actually does it (verified in their shipped bundle):
  // the day strip lives in a REAL overflow-x scroller with
  // `scroll-snap-type: x mandatory`; every column is a snap point, and an
  // invisible `scroll-snap-stop: always` "hard stop" guide one week out
  // natively brakes a monster fling at exactly 7 days. ALL momentum and
  // deceleration is the browser's own scroll engine — zero custom physics.
  // Our job is only: keep the header strip glued to the scroll, commit
  // whole-day shifts once scrolling settles, and re-centre the scroller.
  const rootRef = useRef<HTMLDivElement>(null);
  const panWinRef = useRef<HTMLDivElement>(null);
  const headerStripRef = useRef<HTMLDivElement>(null);
  // The pinned all-day/TBD row's strip — mirrors the pan exactly like the header.
  const pinnedStripRef = useRef<HTMLDivElement>(null);
  const pinnedRowRef = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState(0);
  const colWRef = useRef(0);
  const settleTimer = useRef<number | null>(null);
  const suppressRef = useRef(false); // ignore scroll events we caused ourselves
  const didPanRef = useRef(false);
  // Last whole-day offset reported to onLivePan (change-gated in the listener).
  const livePanRef = useRef(0);
  const onLivePanRef = useRef(onLivePan);
  onLivePanRef.current = onLivePan;
  useEffect(() => {
    colWRef.current = colW;
  }, [colW]);

  // Measure a column's pixel width — for commit math only, never layout.
  useLayoutEffect(() => {
    if (!panEnabled) return;
    const el = panWinRef.current;
    if (!el) return;
    const measure = () => setColW(el.clientWidth / daysToShow);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [panEnabled, daysToShow]);

  const liveColW = () =>
    colWRef.current ||
    (panWinRef.current ? panWinRef.current.clientWidth / daysToShow : 0);

  const setSnap = (on: boolean) => {
    const el = panWinRef.current;
    if (el) el.style.scrollSnapType = on ? "x mandatory" : "none";
  };
  const syncHeader = (sl: number) => {
    const tf = `translateX(${-sl}px)`;
    if (headerStripRef.current) headerStripRef.current.style.transform = tf;
    if (pinnedStripRef.current) pinnedStripRef.current.style.transform = tf;
  };

  // Size the pinned all-day row to the max untimed count across the CURRENTLY
  // VISIBLE slice — driven imperatively from the scroll position so it resizes
  // live as you pan (no React re-render, no waiting for settle). Height 0
  // collapses the row (display:none) so a week with nothing untimed shows none.
  const PIN_BAR = 18;
  const PIN_GAP = 3;
  const PIN_PAD = 8;
  const prevPinHeightRef = useRef(0);
  const applyPinHeight = () => {
    const row = pinnedRowRef.current;
    const win = panWinRef.current;
    const cw = liveColW();
    if (!row) return;
    const off = win && cw ? Math.round((win.scrollLeft - BUFFER * cw) / cw) : 0;
    const from = BUFFER + off;
    let m = 0;
    for (let i = from; i < from + daysToShow; i++) {
      const c = tbdCountsRef.current[i] ?? 0;
      if (c > m) m = c;
    }
    const h = m > 0 ? m * PIN_BAR + (m - 1) * PIN_GAP + PIN_PAD : 0;
    row.style.height = `${h}px`;
    row.style.display = h > 0 ? "flex" : "none";
    // The pinned row sits ABOVE the scroll body, so a height change moves the
    // whole time grid on screen. Compensate scrollTop by the delta so the grid
    // stays put under the cursor (scheduling/completing/unscheduling a TBD
    // card used to visibly jump the viewport). Skipped at the very top, where
    // the user is looking at the row itself and should see it resize in place.
    const prev = prevPinHeightRef.current;
    prevPinHeightRef.current = h;
    const sc = scrollRef.current;
    if (sc && prev !== h && sc.scrollTop > 0) {
      sc.scrollTop = Math.max(0, sc.scrollTop + (h - prev));
    }
  };
  const applyPinHeightRef = useRef(applyPinHeight);
  applyPinHeightRef.current = applyPinHeight;

  // Re-centre the scroller instantly (snap off so the browser doesn't fight
  // the assignment), keeping the header glued.
  const centreScroll = () => {
    const el = panWinRef.current;
    const cw = liveColW();
    if (!el || !cw) return;
    suppressRef.current = true;
    setSnap(false);
    el.scrollLeft = BUFFER * cw;
    syncHeader(el.scrollLeft);
    requestAnimationFrame(() => {
      setSnap(true);
      suppressRef.current = false;
    });
  };
  const centreScrollRef = useRef(centreScroll);
  centreScrollRef.current = centreScroll;

  // Once the scroll has settled: if it's sitting on a column, commit the
  // whole-day shift and re-centre in the same paint (flushSync → no jump).
  // If it stopped BETWEEN columns (snap was off — drag or forwarded wheel),
  // smooth-scroll onto the nearest column first; the next settle commits.
  const settleCommit = () => {
    const el = panWinRef.current;
    const cw = liveColW();
    if (!el || !cw) return;
    const raw = (el.scrollLeft - BUFFER * cw) / cw;
    const cols = Math.round(raw);
    if (Math.abs(raw - cols) > 0.02) {
      el.scrollTo({ left: (BUFFER + cols) * cw, behavior: "smooth" });
      return; // its scroll events re-arm the settle timer
    }
    if (cols !== 0) {
      suppressRef.current = true;
      setSnap(false);
      // scrollLeft grew past centre = the view moved to LATER days.
      flushSync(() => onShiftDays?.(cols));
      el.scrollLeft = BUFFER * cw;
      syncHeader(el.scrollLeft);
      // The offset is now baked into startDate — the live preview returns to 0.
      livePanRef.current = 0;
      onLivePanRef.current?.(0);
    }
    requestAnimationFrame(() => {
      setSnap(true);
      suppressRef.current = false;
    });
  };
  const settleCommitRef = useRef(settleCommit);
  settleCommitRef.current = settleCommit;

  // Centre on mount and whenever the column width (re)measures.
  useLayoutEffect(() => {
    if (!panEnabled || !colW) return;
    centreScrollRef.current();
  }, [panEnabled, colW]);

  // ⚠️ Re-centre (snap OFF, before paint) on every programmatic week change —
  // arrows, Today, mini-month. CSS scroll-snap does SNAP-TARGET TRACKING: the
  // browser remembers which element it is snapped to and FOLLOWS it through
  // re-layout. Columns are keyed by date, so after "next week" the previously
  // snapped column still exists 7 columns into the buffer — Chrome follows it,
  // scrollLeft jumps a week, scrollend fires, and the settle logic reads the
  // jump as a user pan and commits the navigation straight back. (Verified
  // with the debug HUD: N clicks → N compensating shifts → net zero.)
  // centreScroll suppresses scroll events and disables snap across the write,
  // so there is nothing to track and nothing for the settle to misread.
  useLayoutEffect(() => {
    if (!panEnabled) return;
    centreScrollRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panEnabled, startDate]);

  // Re-glue the header after EVERY render: React re-writes the header strip's
  // style attribute (it renders with stripStyle), clobbering the imperative
  // translateX(-scrollLeft) — so any unrelated re-render (selecting a card,
  // opening a menu) visibly jolted the day header until the next scroll event.
  // No dep array on purpose.
  useLayoutEffect(() => {
    if (!panEnabled) return;
    const el = panWinRef.current;
    if (el) syncHeader(el.scrollLeft);
  });

  // Native listeners: keep the header glued to the scroll, and commit ONLY
  // when the gesture has TRULY ended. `scrollend` is the browser's own
  // finger-lift/inertia-done signal — it does NOT fire during a pause inside
  // an ongoing gesture. A timer must never settle early: committing mid-
  // gesture re-centres the strip and re-arms the ±7 hard stops, which is
  // exactly how a long scroll + end-flick blew past a week. The idle timer is
  // only a LONG fallback for browsers without scrollend.
  useEffect(() => {
    if (!panEnabled) return;
    const el = panWinRef.current;
    if (!el) return;
    const hasScrollEnd = "onscrollend" in window;
    const onScroll = () => {
      syncHeader(el.scrollLeft);
      applyPinHeightRef.current(); // resize the pinned row live with the pan
      // Live viewport tracking: report the whole-day offset the instant the
      // strip crosses a day boundary — the sidebar mini-month follows the pan
      // in real time rather than waiting for the settle. Gated on change so
      // React only hears about day-crossings, not every scrolled pixel.
      const cw = liveColW();
      if (cw) {
        const days = Math.round((el.scrollLeft - BUFFER * cw) / cw);
        if (days !== livePanRef.current) {
          livePanRef.current = days;
          onLivePanRef.current?.(days);
        }
      }
      if (suppressRef.current || hasScrollEnd) return;
      if (settleTimer.current != null) clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(
        () => settleCommitRef.current(),
        600,
      );
    };
    const onScrollEnd = () => {
      if (suppressRef.current) return;
      if (settleTimer.current != null) clearTimeout(settleTimer.current);
      settleCommitRef.current();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", onScrollEnd);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", onScrollEnd);
      if (settleTimer.current != null) clearTimeout(settleTimer.current);
    };
  }, [panEnabled]);

  // Horizontal wheel over calendar chrome OUTSIDE the scroller (month bar, day
  // header) still pans: forward the deltas into the scroller. Snap is disabled
  // during forwarding (programmatic scrollLeft writes would fight mandatory
  // snap); the settle pass eases onto a column and re-enables it.
  useEffect(() => {
    if (!panEnabled) return;
    const root = rootRef.current;
    const win = panWinRef.current;
    if (!root || !win) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical → scroll
      if (win.contains(e.target as Node)) return; // native path handles it
      e.preventDefault();
      setSnap(false);
      win.scrollLeft += e.deltaX; // fires the scroll listener → settle timer
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panEnabled]);

  // Drag the date-header strip to pan: drives the native scroller directly
  // (snap off while the pointer is down), then a directional-ceil target with
  // a one-week cap eases in via native smooth scrolling; the settle listener
  // commits and re-enables snap.
  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (!panEnabled || e.button !== 0) return;
    e.stopPropagation(); // don't start a selection lasso / clear selection
    const el = panWinRef.current;
    if (!el) return;
    didPanRef.current = false;
    const startX = e.clientX;
    const startSL = el.scrollLeft;
    let lastX = e.clientX;
    let lastT = performance.now();
    let vel = 0; // scroll px/ms (positive = toward later days), smoothed
    const move = (ev: PointerEvent) => {
      const now = performance.now();
      const dt = now - lastT || 16;
      if (!didPanRef.current && Math.abs(ev.clientX - startX) > 4) {
        didPanRef.current = true;
        setSnap(false);
      }
      if (didPanRef.current) {
        const dx = ev.clientX - lastX;
        el.scrollLeft -= dx; // drag right → earlier days
        vel = vel * 0.6 + (-dx / dt) * 0.4;
      }
      lastX = ev.clientX;
      lastT = now;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!didPanRef.current) return; // was a click → the day button handles it
      const cw = liveColW();
      if (!cw) return;
      const centre = BUFFER * cw;
      const fromCol = (el.scrollLeft - centre) / cw;
      const startCol = (startSL - centre) / cw;
      // Directional ceil: project the coast (v²/2F) and resolve to the next
      // whole column in the drag's direction; cap at one week from where the
      // drag began.
      let t: number;
      if (Math.abs(vel) >= 0.04) {
        const travel = (vel * vel) / (2 * 0.01) / cw;
        t =
          vel > 0
            ? Math.ceil(fromCol + travel - 0.04)
            : Math.floor(fromCol - travel + 0.04);
      } else {
        t = Math.round(fromCol);
      }
      t = Math.max(startCol - SWIPE_CAP, Math.min(startCol + SWIPE_CAP, t));
      t = Math.max(-BUFFER, Math.min(BUFFER, Math.round(t)));
      el.scrollTo({ left: centre + t * cw, behavior: "smooth" });
      // its scroll events drive the settle listener → commit + snap back on
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Strip sizing shared by the header and grid strips (2·BUFFER extra columns
  // wide). The grid strip scrolls natively; the header strip mirrors it via a
  // transform written in the scroll listener.
  const stripStyle: React.CSSProperties = panEnabled
    ? {
        width: `${(days.length / daysToShow) * 100}%`,
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
      }
    : { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };

  const blocksById = useMemo(
    () => new Map(blocks.map((b) => [b.id, b])),
    [blocks],
  );
  const itemsById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );

  const placed: Placed[] = useMemo(() => {
    const visible = new Set(days.map(toISODate));
    const out: Placed[] = [];
    for (const s of steps) {
      // Keep done steps visible on the calendar (crossed out, dimmed)
      // so users can see what they've completed. They're only omitted
      // from the Gantt staircase (where the Completed block handles them).
      const item = itemsById.get(s.item_id);
      if (!item) continue;
      // Blockless (calendar-only) items render with a neutral treatment. An
      // item with a real block_id whose block is gone is an orphan — hidden
      // here exactly as the Gantt hides it.
      let block: { name: string; color: string; icon: string | null };
      if (item.block_id) {
        const b = blocksById.get(item.block_id);
        if (!b) continue;
        block = b;
      } else {
        block = CALENDAR_ONLY_BLOCK;
      }
      const date = toISODate(
        addDays(parseISODate(item.start_date), s.day_offset),
      );
      if (!visible.has(date)) continue;
      // null offset = no time_of_day at all → TBD. Otherwise the step is timed
      // and we clamp its offset into the visible window on BOTH ends: a time
      // before START_HOUR pins to the top of the grid, one at/after END_HOUR
      // pins just inside the bottom — so an out-of-window event is always
      // reachable on the grid instead of rendering off-screen (top past the
      // grid height). The card's DISPLAYED time comes from step.time_of_day in
      // EventBlock, not from this offset, so clamping only repositions the card;
      // it never misreports the real time.
      const rawMin = parseStartMin(s.time_of_day, START_HOUR);
      const isTbd = rawMin === null;
      const startMin =
        rawMin === null ? -1 : Math.min(Math.max(0, rawMin), HOURS * 60 - 15);
      out.push({
        step: s,
        item,
        block,
        date,
        isTbd,
        startMin,
        durationMin: s.duration_min ?? DEFAULT_EVENT_MIN,
      });
    }
    return out;
  }, [steps, items, days, itemsById, blocksById, START_HOUR, HOURS]);

  const placedByStep = useMemo(() => {
    const m = new Map<string, Placed>();
    for (const p of placed) m.set(p.step.id, p);
    return m;
  }, [placed]);

  const byDate = useMemo(() => {
    const m = new Map<string, Placed[]>();
    for (const d of days) m.set(toISODate(d), []);
    for (const p of placed) m.get(p.date)?.push(p);
    return m;
  }, [days, placed]);

  // Steps currently being dragged — hidden from the TBD row so they don't
  // ghost their old position while the drag ghost shows in the time grid.
  const draggingIds = useMemo(() => {
    const s = new Set<string>();
    if (drag) {
      s.add(drag.stepId);
      for (const f of drag.followers) s.add(f.stepId);
    }
    return s;
  }, [drag]);
  // Untimed count per RENDERED day (aligned to `days`). The pinned row is sized
  // to the max over just the currently-visible slice of this — computed live in
  // the scroll listener so the row resizes as you pan, not on settle.
  // Deliberately INCLUDES cards mid-drag: the render excludes them (no ghost in
  // the old slot) but the row's HEIGHT must not collapse the instant a card is
  // picked up — that shifted the whole time grid under the cursor mid-gesture.
  const tbdCounts = useMemo(
    () =>
      days.map(
        (d) => (byDate.get(toISODate(d)) ?? []).filter((e) => e.isTbd).length,
      ),
    [days, byDate],
  );
  const tbdCountsRef = useRef(tbdCounts);
  tbdCountsRef.current = tbdCounts;
  // Any rendered (visible or buffered) day has an untimed step → the row exists
  // so it can grow/shrink live as busier days pan into view.
  const maxBufferedTbd = useMemo(
    () => tbdCounts.reduce((m, c) => Math.max(m, c), 0),
    [tbdCounts],
  );
  // Re-apply the pinned-row height on mount and whenever the counts / column
  // width / committed week change (before paint, so no wrong-height flash).
  useLayoutEffect(() => {
    applyPinHeightRef.current();
  }, [tbdCounts, colW, startDate, daysToShow]);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    // Open at ~8AM. When the TBD row is tall enough to scroll with the grid it
    // sits above the time grid, so offset past it; when pinned it's outside the
    // scroll body and the grid starts at the top (offset 0).
    const grid = gridRef.current;
    const gridOffset = grid
      ? grid.getBoundingClientRect().top -
        sc.getBoundingClientRect().top +
        sc.scrollTop
      : 0;
    const at8 = gridOffset + (8 - START_HOUR) * HOUR_H;
    // ⚠️ Land HOUR_LABEL_BLEED above the 8AM line, not on it. Every hour label
    // except the first straddles its own gridline (`-top-1.5` in the gutter
    // below), so an hour parked exactly at the top of the scroll viewport has
    // its upper half above that viewport and is sliced in half by the pinned
    // ALL DAY strip. MEASURED: opening Week showed "8 AM" with only its lower
    // half drawn, on every open, in both themes — the `i === 0` special case
    // in the gutter only ever protected the UNSCROLLED case, and this effect
    // scrolls. The guard keeps the old behaviour when 8AM is already at or
    // above the grid's top (a `calendarStartHour` of 8 or later), where the
    // first-row `top-0.5` label is safe on its own.
    sc.scrollTop = at8 > gridOffset ? at8 - HOUR_LABEL_BLEED : at8;
  }, [HOUR_H, START_HOUR]);

  // (The old in-body TBD row and its scrollTop-compensation effect lived here.
  // The row was dead code — computed but never rendered, superseded by the
  // PINNED all-day row — and the effect it drove measured an offset that
  // therefore never changed. The real compensation now lives in
  // applyPinHeight, keyed to the pinned row's actual height.)

  // ── Bulk action wrappers — apply to whole selection if trigger is part of it ──
  const bulkDeleteStep = useCallback(
    async (triggerStep: Step) => {
      const ids =
        selectionRef.current.has(triggerStep.id) &&
        selectionRef.current.size > 1
          ? Array.from(selectionRef.current)
          : [triggerStep.id];
      if (ids.length > 1) {
        const ok = await dialogs.confirm({
          title: `Delete ${ids.length} steps?`,
          message: "All selected steps will be removed.",
          confirmLabel: "Delete",
          destructive: true,
        });
        if (!ok) return;
      }
      const targets = ids
        .map((id) => steps.find((s) => s.id === id))
        .filter((s): s is Step => !!s);
      for (const s of targets) onDeleteStep(s);
      clearSelection();
    },
    [dialogs, steps, onDeleteStep],
  );

  const bulkToggleDone = useCallback(
    (triggerStep: Step) => {
      const ids =
        selectionRef.current.has(triggerStep.id) &&
        selectionRef.current.size > 1
          ? Array.from(selectionRef.current)
          : [triggerStep.id];
      const targets = ids
        .map((id) => steps.find((s) => s.id === id))
        .filter((s): s is Step => !!s);
      for (const s of targets) onToggleStepDone(s);
    },
    [steps, onToggleStepDone],
  );

  // ── Drag manager ─────────────────────────────────────────────────────
  const startDrag = useCallback(
    (
      stepId: string,
      kind: DragKind,
      e: React.PointerEvent,
      originPlaced: Placed,
      grabOffsetPx: number,
    ) => {
      e.preventDefault();
      const grabOffsetMin = (grabOffsetPx / HOUR_H) * 60;
      const sel = selectionRef.current;
      const followers: DragFollower[] = [];
      if (sel.has(stepId) && sel.size > 1) {
        for (const id of sel) {
          if (id === stepId) continue;
          const p = placedByStep.get(id);
          if (!p) continue;
          followers.push({
            stepId: id,
            isTbd: p.isTbd,
            date: p.date,
            startMin: p.isTbd ? 0 : p.startMin,
            durationMin: p.durationMin,
          });
        }
      }
      setDrag({
        stepId,
        kind,
        originDate: originPlaced.date,
        originStartMin: originPlaced.isTbd ? 0 : originPlaced.startMin,
        originDurationMin: originPlaced.durationMin,
        grabOffsetMin,
        currentDate: originPlaced.date,
        currentStartMin: originPlaced.isTbd ? 0 : originPlaced.startMin,
        followers,
      });
    },
    [HOUR_H, placedByStep],
  );

  // Begin a drag for a step that isn't on the grid (the sidebar's unscheduled
  // tray). Modelled as a TBD drag anchored on the step's own occurrence day, so
  // the existing move/drop math lands it on whatever column+time it's dropped on
  // — with the same snapping ghost as any card. The pointer is already down; the
  // window listeners take over once this sets the drag state.
  const beginExternalDrag = useCallback(
    (stepId: string, occurrenceDate: string, durationMin: number) => {
      setDrag({
        stepId,
        kind: "tbd",
        originDate: occurrenceDate,
        originStartMin: 0,
        originDurationMin: durationMin,
        grabOffsetMin: 0,
        currentDate: occurrenceDate,
        currentStartMin: 0,
        followers: [],
      });
    },
    [],
  );
  useEffect(() => {
    registerBeginDrag?.(beginExternalDrag);
  }, [registerBeginDrag, beginExternalDrag]);

  // Drag pointermove/up. Routed through refs so a mid-drag config change
  // (snap, hour height, start hour) doesn't tear down the listener — and we
  // never read a stale closure for `onUpdateStep`, `steps`, etc.
  const moveRef = useRef<(e: PointerEvent) => void>(() => {});
  const upRef = useRef<() => void>(() => {});
  moveRef.current = (e: PointerEvent) => {
    if (!drag) return;
    let overDate = drag.currentDate;
    for (const [date, el] of dayColRefs.current.entries()) {
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right) {
        overDate = date;
        break;
      }
    }
    const colEl = dayColRefs.current.get(overDate);
    if (!colEl) return;
    const r = colEl.getBoundingClientRect();
    const y = e.clientY - r.top;
    const cursorMin = (y / HOUR_H) * 60;
    const desiredMin = cursorMin - drag.grabOffsetMin;
    // Clamp INTO the grid on both ends. The pointer can travel below the last
    // hour row mid-drag; unclamped that committed a time past the end hour —
    // with the default 24:00 grid bottom, literally "24:15", which
    // `stepUpdateSchema`'s `time_of_day` rejects, so the write is refused and
    // then logged and dropped: the card sits at a time that is not on disk.
    const snapped = Math.min(
      Math.max(0, snapMin(desiredMin)),
      HOURS * 60 - SLOT_MIN,
    );
    setDrag((d) =>
      d ? { ...d, currentDate: overDate, currentStartMin: snapped } : d,
    );
  };
  upRef.current = () => {
    if (!drag) return;
    const d = drag;
    const dayDelta = daysBetween(d.originDate, d.currentDate);
    const minDelta = d.currentStartMin - d.originStartMin;
    const movedDay = dayDelta !== 0;
    const movedTime = minDelta !== 0 || d.kind === "tbd";

    // Primary
    const primary = steps.find((s) => s.id === d.stepId);
    if (primary) {
      const patch: Partial<Step> = {};
      if (movedTime)
        patch.time_of_day = minToTime24(d.currentStartMin, START_HOUR);
      // Deliberately UNCLAMPED: a drop before the item's start_date yields a
      // negative offset, and the board's handler shifts the item's start back
      // (applyItemMove) so the card lands on the day it was dropped. The old
      // Math.max(0, …) silently relocated it to the item's first day instead.
      if (movedDay) patch.day_offset = primary.day_offset + dayDelta;
      if (Object.keys(patch).length) onUpdateStep(d.stepId, patch);
    }

    // Followers: apply same delta. TBD followers stay TBD.
    for (const f of d.followers) {
      const step = steps.find((s) => s.id === f.stepId);
      if (!step) continue;
      const patch: Partial<Step> = {};
      if (movedDay) patch.day_offset = Math.max(0, step.day_offset + dayDelta);
      if (!f.isTbd && minDelta !== 0) {
        patch.time_of_day = minToTime24(
          Math.max(0, f.startMin + minDelta),
          START_HOUR,
        );
      }
      if (Object.keys(patch).length) onUpdateStep(f.stepId, patch);
    }

    // The tray follows the day you just dropped into.
    onFocusDay?.(d.currentDate);
    setDrag(null);
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => moveRef.current(e);
    const up = () => upRef.current();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag]);

  // (Dead in-body TBD row removed — the pinned all-day row below the day
  // header is the real one.)

  return (
    <div
      ref={rootRef}
      // min-h-0 lets this flex child shrink to the available height instead of
      // its (tall) content, so the body below scrolls *internally* (TBD row +
      // time grid) while the day header stays pinned at the top.
      // overscroll-x-none stops a horizontal trackpad swipe from triggering the
      // browser's back/forward navigation.
      className="flex min-h-0 flex-1 flex-col overscroll-x-none bg-bg select-none"
      onPointerDown={
        isMobile
          ? undefined
          : (e) => {
              // Same spreadsheet rule as the grid: pressing bare calendar
              // chrome (header, TBD-row background, time gutter) drops the
              // selection. Cards and controls stop propagation or are
              // excluded, so they keep it.
              const t = e.target as Element;
              if (
                !e.shiftKey &&
                !t.closest(
                  '[data-cal-card], button, input, textarea, [role="button"]',
                )
              ) {
                clearSelection();
              }
              onBodyPointerDown(e);
            }
      }
    >
      {/* Month + year label (à la Notion) on the left, nav/view controls on
          the right — the calendar's own control bar, below the app top bar. */}
      <div className="flex shrink-0 items-center gap-3 bg-bg-elev py-2 pl-4 pr-3">
        <h2 className="text-[21.6px] font-semibold tracking-tight text-text">
          {monthYearLabel}
        </h2>
        {headerControls && (
          <div className="ml-auto flex items-center">{headerControls}</div>
        )}
      </div>
      {/* Day header */}
      <div
        className="sticky top-0 z-30 flex border-b border-border bg-bg-elev"
        style={{ height: HEADER_H }}
      >
        <div
          className="flex shrink-0 items-center px-3 text-[9px] text-text-dim"
          style={{ width: TIME_COL_W }}
        >
          {onBackToWeek ? (
            <button
              onClick={onBackToWeek}
              className="rounded px-1 text-text-muted hover:bg-surface hover:text-text"
              title="Back to week"
            >
              ← Week
            </button>
          ) : (
            <>
              GMT
              {(() => {
                const off = -new Date().getTimezoneOffset() / 60;
                return (off >= 0 ? "+" : "") + off;
              })()}
            </>
          )}
        </div>
        <div
          onPointerDown={onHeaderPointerDown}
          className={cn(
            "relative flex-1 overflow-hidden",
            panEnabled && "cursor-grab active:cursor-grabbing",
          )}
        >
        <div ref={headerStripRef} className="grid h-full" style={stripStyle}>
          {days.map((d, i) => (
            <button
              key={i}
              onClick={() => {
                // Suppress the click that ends a pan-drag; a real click picks the day.
                if (didPanRef.current) {
                  didPanRef.current = false;
                  return;
                }
                onPickDay?.(toISODate(d));
              }}
              className={cn(
                "flex flex-row items-center justify-center gap-1.5 transition hover:bg-surface/40",
                onPickDay && "cursor-pointer",
                panEnabled && "cursor-grab active:cursor-grabbing",
              )}
              title={onPickDay ? "Click for day view" : undefined}
            >
              <span className="text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
                {daysToShow === 1 ? fmtFull(d) : fmtDay(d).toUpperCase()}
              </span>
              {daysToShow > 1 && (
                <span
                  className={cn(
                    "text-[9.5px] font-medium tabular-nums",
                    isToday(d)
                      ? "rounded-md bg-accent px-1.5 py-0.5 text-white"
                      : "text-text-muted",
                  )}
                >
                  {d.getDate()}
                </span>
              )}
            </button>
          ))}
        </div>
        </div>
      </div>

      {/* Pinned all-day/TBD row — Notion-style. Sits BETWEEN the day header
          and the scroll body, so it never moves on vertical scroll; its strip
          mirrors the horizontal pan via syncHeader. Thin solid-colour bars
          (~a 15-minute block tall), text in a light/dark blend of the block
          colour per theme. Rendered only when something is untimed. */}
      {maxBufferedTbd > 0 && (
        <div
          ref={pinnedRowRef}
          className="flex shrink-0 overflow-hidden border-b border-border bg-bg-elev"
        >
          <div
            className="flex shrink-0 items-start justify-end border-r border-border px-2 pt-1 text-[8.1px] uppercase tracking-wider text-text-dim"
            style={{ width: TIME_COL_W }}
          >
            All day
          </div>
          <div className="relative flex-1 overflow-hidden">
            {/* Height lives on the row (set imperatively from the scroll
                position → resizes live with the pan). Columns clip so a busier
                buffered day can't stretch it. */}
            <div ref={pinnedStripRef} className="grid h-full" style={stripStyle}>
              {days.map((d) => {
                const date = toISODate(d);
                const dayTbds = (byDate.get(date) ?? []).filter(
                  (e) => e.isTbd && !draggingIds.has(e.step.id),
                );
                return (
                  <div
                    key={date}
                    className="flex min-w-0 flex-col gap-[3px] overflow-hidden border-r border-border px-1 py-1"
                  >
                    {dayTbds.map((p) => (
                      <PinnedBar
                        key={p.step.id}
                        placed={p}
                        isDark={isDark}
                        blocks={blocks}
                        onStartDrag={(e, grabOffsetPx) =>
                          startDrag(p.step.id, "tbd", e, p, grabOffsetPx)
                        }
                        onUpdate={(patch) => onUpdateStep(p.step.id, patch)}
                        onUpdateItem={onUpdateItem}
                        onDelete={() => bulkDeleteStep(p.step)}
                        onToggleDone={() => bulkToggleDone(p.step)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Scrollable body */}
      <div
        ref={scrollRef}
        className="no-scrollbar flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div
          ref={gridRef}
          className="flex"
          style={{ minHeight: HOUR_H * HOURS }}
        >
          {/* Time column (hour labels) */}
          <div
            className="sticky left-0 z-10 shrink-0 border-r border-border bg-bg"
            style={{ width: TIME_COL_W }}
          >
            <CurrentTimeBadge
              startHour={START_HOUR}
              hours={HOURS}
              hourH={HOUR_H}
            />
            {Array.from({ length: HOURS }, (_, i) => {
              const h24 = START_HOUR + i;
              const h12 = h24 % 12 || 12;
              const ampm = h24 < 12 || h24 === 24 ? "AM" : "PM";
              return (
                <div
                  key={i}
                  className="relative text-[9px] text-text-dim"
                  style={{ height: HOUR_H }}
                >
                  {/* The first label straddles the grid's top edge, so it clips
                      under the header — sit it just below instead. */}
                  <span
                    className={cn(
                      "absolute right-2",
                      i === 0 ? "top-0.5" : "-top-1.5",
                    )}
                  >
                    {h12} {ampm}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Day columns — a NATIVE horizontal scroller over the buffered
              strip. CSS scroll-snap gives the Notion feel: the browser's own
              momentum decelerates into a column, and the hard-stop guides
              below brake any fling at exactly one week. */}
          <div
            ref={panWinRef}
            className={cn(
              "relative flex-1",
              panEnabled
                ? "no-scrollbar overflow-x-auto overflow-y-hidden"
                : "overflow-hidden",
            )}
            style={
              panEnabled
                ? {
                    scrollSnapType: "x mandatory",
                    overscrollBehaviorX: "contain",
                    // ⚠️ Scroll anchoring must be OFF in a programmatically
                    // managed scroller. When a week-change re-renders the strip,
                    // Chrome's anchoring "helpfully" adjusts scrollLeft to keep
                    // the OLD content in view — our settle logic then reads that
                    // as a user pan and commits the week straight back, so
                    // Today/prev/next/mini-month clicks appear to do nothing.
                    // Extension-injected DOM nodes make Chrome pick anchors far
                    // more eagerly, which is why it broke with a VPN extension
                    // on and not in incognito.
                    overflowAnchor: "none",
                  }
                : undefined
            }
          >
          <div
            data-cal-strip
            className="relative grid"
            style={{ ...stripStyle, minHeight: HOUR_H * HOURS }}
          >
            {/* Hard stops one week out from centre: `scroll-snap-stop: always`
                makes the native fling brake INTO these — the graceful monster-
                flick deceleration, enforced by the browser. */}
            {panEnabled && (
              <>
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 0,
                    height: "100%",
                    width: 1,
                    visibility: "hidden",
                    left: `${((BUFFER - SWIPE_CAP) / days.length) * 100}%`,
                    scrollSnapAlign: "start",
                    scrollSnapStop: "always",
                  }}
                />
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 0,
                    height: "100%",
                    width: 1,
                    visibility: "hidden",
                    left: `${((BUFFER + SWIPE_CAP) / days.length) * 100}%`,
                    scrollSnapAlign: "start",
                    scrollSnapStop: "always",
                  }}
                />
              </>
            )}
            <CurrentTimeMarker
              days={days}
              startHour={START_HOUR}
              hours={HOURS}
              hourH={HOUR_H}
            />
            {days.map((d) => {
              const date = toISODate(d);
              const all = byDate.get(date) ?? [];
              return (
                <DayColumn
                  key={date}
                  date={date}
                  events={all}
                  isFlashing={!!flashDate && flashDate === date}
                  registerRef={(el) => {
                    if (el) dayColRefs.current.set(date, el);
                    else dayColRefs.current.delete(date);
                  }}
                  selection={selection}
                  blocks={blocks}
                  isDark={isDark}
                  onSelectStep={selectStep}
                  onClearSelection={clearSelection}
                  onBulkDelete={bulkDeleteStep}
                  onBulkToggleDone={bulkToggleDone}
                  onUpdateStep={onUpdateStep}
                  onRepeatStep={onRepeatStep}
                  onUpdateItem={onUpdateItem}
                  onStartDrag={startDrag}
                  onDragCreate={
                    onCreateTask
                      ? (c) =>
                          setDraft({
                            date: c.date,
                            startMin: c.startMin,
                            durationMin: c.durationMin,
                            x: c.clientX,
                            y: c.clientY,
                          })
                      : undefined
                  }
                  pendingCreate={
                    draft && draft.date === date
                      ? {
                          startMin: draft.startMin,
                          durationMin: draft.durationMin,
                        }
                      : null
                  }
                  drag={drag}
                  hours={HOURS}
                  hourH={HOUR_H}
                  slotMin={SLOT_MIN}
                  startHour={START_HOUR}
                  onFocusDay={onFocusDay}
                />
              );
            })}
          </div>
          </div>
        </div>
      </div>

      {/* Marquee */}
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

      {draft && onCreateTask && (
        <QuickCreatePopover
          x={draft.x}
          y={draft.y}
          date={draft.date}
          startMin={draft.startMin}
          durationMin={draft.durationMin}
          startHour={START_HOUR}
          blocks={blocks}
          onClose={() => setDraft(null)}
          onSubmit={({ blockId, title, recurringDays }) => {
            onCreateTask({
              date: draft.date,
              time: minToTime24(draft.startMin, START_HOUR),
              durationMin: draft.durationMin,
              blockId,
              title,
              recurringDays,
            });
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

/** Google-Calendar-style quick-create popover for a dragged time slot. */
function QuickCreatePopover({
  x,
  y,
  date,
  startMin,
  durationMin,
  startHour,
  blocks,
  onClose,
  onSubmit,
}: {
  x: number;
  y: number;
  date: string;
  startMin: number;
  durationMin: number;
  startHour: number;
  blocks: Block[];
  onClose: () => void;
  onSubmit: (v: {
    blockId: string | null;
    title: string;
    recurringDays: number[] | null;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [blockId, setBlockId] = useState("");
  const [recurring, setRecurring] = useState(false);
  // Default the pattern to the weekday the user dragged on.
  const [days, setDays] = useState<Set<number>>(
    () => new Set([new Date(date + "T00:00:00").getDay()]),
  );
  const ref = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => [ref], []);
  useOutsideClick(refs, onClose);
  useEscape(onClose);

  const W = 270;
  // Smart spawn: measure the real height and clamp so the whole panel stays on
  // screen — dragging near the bottom no longer hides half the popover. Remeasure
  // when the recurring day-picker expands/collapses.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      left: Math.max(8, Math.min(x + 12, vw - W - 8)),
      top: Math.max(8, Math.min(y, vh - h - 8)),
    });
  }, [x, y, recurring]);

  const selectable = blocks.filter((b) => !b.is_system);

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function submit() {
    onSubmit({
      blockId: blockId || null,
      title: title.trim(),
      recurringDays:
        recurring && days.size > 0
          ? Array.from(days).sort((a, b) => a - b)
          : null,
    });
  }

  const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <motion.div
      ref={ref}
      // Same leak-guard as the other popovers: keep presses out of the
      // (drag-create) grid handlers underneath.
      // grid's pointer-capturing drag handlers underneath.
      onPointerDown={(e) => e.stopPropagation()}
      initial={{ opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        width: W,
        zIndex: 70,
        visibility: pos ? "visible" : "hidden",
        // Frosted glass — matches the edit popover.
        background: "var(--frost, var(--bg-elev))",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid color-mix(in srgb, var(--text) 12%, transparent)",
      }}
      className="rounded-2xl p-3.5 shadow-2xl shadow-black/40"
    >
      <div className="relative">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-surface hover:text-text"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="New task"
          className="w-full bg-transparent pr-7 text-[14.4px] font-semibold leading-snug placeholder:text-text-dim/60 focus:outline-none"
        />
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10.8px] tabular-nums text-text-muted">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-text-dim" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {fmtTime12(minToTime24(startMin, startHour))} –{" "}
        {fmtTime12(minToTime24(startMin + durationMin, startHour))}
      </div>

      <div className="mt-3">
        <BlockSelect
          blocks={selectable}
          currentBlockId={blockId || undefined}
          onChange={setBlockId}
          allowNone
          placeholder="No block"
        />
      </div>

      {/* Same custom-checkbox idiom as the confirm dialog's "don't ask
          again" — native input stays for a11y but is visually replaced. */}
      <label className="mt-3 flex cursor-pointer items-center gap-2 px-0.5 text-[11.2px] text-text transition select-none hover:text-text">
        <span
          aria-hidden
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition",
            recurring
              ? "border-[var(--accent)] bg-[var(--accent)] text-white"
              : "border-border bg-surface hover:border-border-strong",
          )}
        >
          {recurring && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 6.5l2.5 2.5L9.5 3.5" />
            </svg>
          )}
        </span>
        <input
          type="checkbox"
          checked={recurring}
          onChange={(e) => setRecurring(e.target.checked)}
          className="sr-only"
        />
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[11.7px] leading-none transition",
              recurring ? "text-[var(--accent)]" : "text-text-dim",
            )}
          >
            ↻
          </span>
          Recurring task
        </span>
      </label>
      {recurring && (
        <div className="mt-2 flex justify-between gap-1">
          {DAY_LABELS.map((label, d) => {
            const on = days.has(d);
            return (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                aria-pressed={on}
                className={cn(
                  "h-8 w-8 rounded-lg text-[9.9px] font-semibold transition",
                  on
                    ? "bg-accent text-white"
                    : "bg-surface text-text-muted hover:bg-surface-hover hover:text-text",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <button
        onClick={submit}
        className="mt-3 w-full rounded-lg bg-accent py-2 text-[10.8px] font-semibold text-white transition hover:brightness-110"
      >
        Create
      </button>
    </motion.div>
  );
}

function DayColumn({
  date,
  events,
  isFlashing,
  registerRef,
  selection,
  blocks,
  isDark,
  onSelectStep,
  onClearSelection,
  onBulkDelete,
  onBulkToggleDone,
  onUpdateStep,
  onRepeatStep,
  onUpdateItem,
  onStartDrag,
  onDragCreate,
  pendingCreate,
  drag,
  hours,
  hourH,
  slotMin,
  startHour,
  onFocusDay,
}: {
  date: string;
  events: Placed[];
  isFlashing: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
  selection: Set<string>;
  onSelectStep: (id: string, mode: SelectMode) => void;
  onClearSelection: () => void;
  blocks: Block[];
  isDark: boolean;
  onBulkDelete: (s: Step) => void;
  onBulkToggleDone: (s: Step) => void;
  onUpdateStep: (id: string, patch: Partial<Step>) => void;
  onRepeatStep: (source: Step, time: string) => void;
  onUpdateItem?: (id: string, patch: Partial<Item>) => void;
  onStartDrag: (
    stepId: string,
    kind: DragKind,
    e: React.PointerEvent,
    placed: Placed,
    grabOffsetPx: number,
  ) => void;
  onDragCreate?: (input: {
    date: string;
    startMin: number;
    durationMin: number;
    clientX: number;
    clientY: number;
  }) => void;
  /** Keeps the drag preview drawn while the create popover is open. */
  pendingCreate?: { startMin: number; durationMin: number } | null;
  drag: DragState | null;
  hours: number;
  hourH: number;
  slotMin: number;
  startHour: number;
  onFocusDay?: (iso: string) => void;
}) {
  const HOURS = hours;
  const HOUR_H = hourH;
  const SLOT_MIN = slotMin;
  const START_HOUR = startHour;
  const snapMin = (m: number) => Math.round(m / SLOT_MIN) * SLOT_MIN;
  const timed = events.filter((e) => !e.isTbd);

  // Hide primary + all followers during drag (so they don't ghost their old positions)
  const hiddenIds = useMemo(() => {
    const s = new Set<string>();
    if (drag) {
      s.add(drag.stepId);
      for (const f of drag.followers) s.add(f.stepId);
    }
    return s;
  }, [drag]);
  const draggedHere = drag && drag.currentDate === date;
  const dragSourceHere = drag && drag.originDate === date;
  const visibleTimed = timed.filter((e) => !hiddenIds.has(e.step.id));

  const laidOut = layoutOverlaps<Placed>(visibleTimed, HOUR_H);

  // Drag-to-create: a real drag (not a click) on the empty grid sketches a new
  // event and opens the quick-create popover. Shift+drag falls through to the
  // body marquee; event cards stop propagation for their own drag.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const createRef = useRef<{
    a: number;
    b: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [createSel, setCreateSel] = useState<{ a: number; b: number } | null>(
    null,
  );
  const minAtY = (clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const m = snapMin(((clientY - rect.top) / HOUR_H) * 60);
    return Math.max(0, Math.min(HOURS * 60, m));
  };
  const onGridDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.shiftKey) return;
    // Spreadsheet-style: pressing empty grid space drops the selection.
    // (Card presses never reach here — useCardPointer stops propagation.)
    onClearSelection();
    // Clicking into a day's column makes the Unscheduled tray show that day.
    onFocusDay?.(date);
    if (!onDragCreate) return;
    const m = minAtY(e.clientY);
    // Record only — a plain click (no real movement) must NOT create anything.
    createRef.current = { a: m, b: m, startY: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const onGridMove = (e: React.PointerEvent) => {
    const c = createRef.current;
    if (!c) return;
    // Require a few pixels of travel before this counts as a create-drag.
    if (!c.moved && Math.abs(e.clientY - c.startY) <= 5) return;
    c.moved = true;
    c.b = minAtY(e.clientY);
    setCreateSel({ a: c.a, b: c.b });
  };
  const onGridUp = (e: React.PointerEvent) => {
    const c = createRef.current;
    createRef.current = null;
    setCreateSel(null);
    if (!c || !c.moved || !onDragCreate) return; // a click, not a drag
    const lo = Math.min(c.a, c.b);
    const hi = Math.max(c.a, c.b);
    onDragCreate({
      date,
      startMin: lo,
      durationMin: Math.max(SLOT_MIN, hi - lo),
      clientX: e.clientX,
      clientY: e.clientY,
    });
  };

  return (
    <div
      ref={(el) => {
        gridRef.current = el;
        registerRef(el);
      }}
      // Marks this as a real day column for the strip's opt-in scroll-snap
      // rule — extension-injected foreign nodes must never become snap points.
      data-cal-day
      onPointerDown={onGridDown}
      onPointerMove={onGridMove}
      onPointerUp={onGridUp}
      className="relative border-r border-border"
    >
      {isFlashing && (
        <div
          data-search-flash=""
          className="pointer-events-none absolute inset-0 z-[5]"
          aria-hidden
        />
      )}
      {/* Hour grid */}
      <div>
        {Array.from({ length: HOURS }, (_, i) => (
          <div
            key={i}
            className="border-b border-border"
            style={{ height: HOUR_H }}
          />
        ))}
      </div>

      {/* Drag-to-create preview — shown during the drag AND held in place
          while the quick-create popover is open (so the task doesn't vanish). */}
      {(() => {
        const g = createSel
          ? {
              lo: Math.min(createSel.a, createSel.b),
              hi: Math.max(createSel.a, createSel.b),
            }
          : pendingCreate
            ? {
                lo: pendingCreate.startMin,
                hi: pendingCreate.startMin + pendingCreate.durationMin,
              }
            : null;
        if (!g) return null;
        // GCal-style: the preview IS the card — filled accent surface with
        // a live time range, not an empty outline. Content mirrors the real
        // card tiers so what you drag is what you get.
        const previewH = Math.max(20, ((g.hi - g.lo) / 60) * HOUR_H - 2);
        const range =
          fmtTimeRange12(
            minToTime24(g.lo, START_HOUR),
            minToTime24(g.hi, START_HOUR),
          ) ?? "";
        return (
          <div
            className="pointer-events-none absolute z-[6] overflow-hidden rounded-md px-2 py-1 shadow-lg shadow-black/20"
            style={{
              top: (g.lo / 60) * HOUR_H,
              height: previewH,
              // Match the footprint of the card this drag will create
              // (2px left inset, right gutter + 2px card inset).
              left: 2,
              right: CARD_RIGHT_GUTTER + 2,
              background: "var(--accent)",
            }}
          >
            {previewH >= 34 ? (
              <>
                <div className="truncate text-[10.8px] font-semibold leading-tight text-white">
                  New task
                </div>
                <div className="truncate text-[9.5px] font-semibold tabular-nums text-white/80">
                  {range}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center gap-1.5 text-[9.9px] text-white">
                <span className="truncate font-semibold">New task</span>
                <span className="ml-auto shrink-0 text-[9px] font-semibold tabular-nums text-white/80">
                  {range}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Timed events */}
      <AnimatePresence>
        {laidOut.map((p) => (
          <EventBlock
            key={p.step.id}
            placed={p}
            hourH={HOUR_H}
            slotMin={SLOT_MIN}
            snapMin={snapMin}
            isSelected={selection.has(p.step.id)}
            isDark={isDark}
            blocks={blocks}
            onSelect={onSelectStep}
            onUpdate={(patch) => onUpdateStep(p.step.id, patch)}
            onRepeat={(time) => onRepeatStep(p.step, time)}
            onUpdateItem={onUpdateItem}
            onDelete={() => onBulkDelete(p.step)}
            onToggleDone={() => onBulkToggleDone(p.step)}
            onStartDrag={(e, grabOffsetPx) =>
              onStartDrag(p.step.id, "timed", e, p, grabOffsetPx)
            }
          />
        ))}
      </AnimatePresence>

      {/* Ghost */}
      {draggedHere && drag && (
        <DragGhost drag={drag} hourH={HOUR_H} startHour={START_HOUR} />
      )}
      {dragSourceHere && drag && drag.currentDate !== date && (
        <DragGhost drag={drag} hourH={HOUR_H} startHour={START_HOUR} faded />
      )}
    </div>
  );
}

function DragGhost({
  drag,
  hourH,
  startHour,
  faded,
}: {
  drag: DragState;
  hourH: number;
  startHour: number;
  faded?: boolean;
}) {
  const top = (drag.currentStartMin / 60) * hourH;
  const height = Math.max(20, (drag.originDurationMin / 60) * hourH - 2);
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-30 rounded-md border-2 border-dashed",
        faded
          ? "border-text-dim/40 bg-text-dim/10"
          : "border-accent bg-accent/15",
      )}
      style={{ top, height, left: 2, right: CARD_RIGHT_GUTTER + 2 }}
    >
      <div
        className={cn(
          "px-2 py-1 text-[9.9px] font-semibold",
          faded ? "text-text-dim" : "text-accent",
        )}
      >
        {fmtTime12(minToTime24(drag.currentStartMin, startHour))}
        {drag.followers.length > 0 && (
          <span className="ml-2 opacity-70">+{drag.followers.length}</span>
        )}
      </div>
    </div>
  );
}

/** Shared: arms a drag-after-threshold and immediately selects the card. */
function useCardPointer(args: {
  stepId: string;
  isSelected: boolean;
  onSelect: (id: string, mode: SelectMode) => void;
  startDrag: (e: React.PointerEvent, grabOffsetPx: number) => void;
}) {
  return function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // Touch input scrolls the calendar; drag is mouse/pen only. Without
    // this, brushing a finger past a card while scrolling fires the
    // drag arm-and-select path and tries to move the card.
    if (e.pointerType === "touch") return;
    e.stopPropagation();
    // Select first — replace unless modifier
    const mode: SelectMode = e.shiftKey
      ? "extend"
      : e.metaKey || e.ctrlKey
        ? "toggle"
        : args.isSelected
          ? "extend" // keep selection so drag affects whole group
          : "replace";
    args.onSelect(args.stepId, mode);

    // Arm drag-after-threshold
    if ((e.target as HTMLElement).dataset.resize === "true") return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const grabOffsetPx = e.clientY - rect.top;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    function maybeStart(ev: PointerEvent) {
      if (started) return;
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) {
        started = true;
        window.removeEventListener("pointermove", maybeStart);
        window.removeEventListener("pointerup", cancel);
        // Synthesize a React-event-shaped object for startDrag, which only
        // reads `preventDefault`. TODO(sprint-2): change startDrag's signature
        // to accept primitives so we can drop this shim.
        // eslint-disable-next-line no-restricted-syntax
        const synth = {
          ...e,
          clientX: ev.clientX,
          clientY: ev.clientY,
          preventDefault: () => ev.preventDefault(),
        } as unknown as React.PointerEvent;
        args.startDrag(synth, grabOffsetPx);
      }
    }
    function cancel() {
      window.removeEventListener("pointermove", maybeStart);
      window.removeEventListener("pointerup", cancel);
    }
    window.addEventListener("pointermove", maybeStart);
    window.addEventListener("pointerup", cancel);
  };
}

/**
 * One thin bar in the pinned all-day/TBD row: solid block colour, ~a
 * 15-minute block tall, label tinted toward white (dark mode) or black
 * (light mode). Click opens the full editor.
 */
function PinnedBar({
  placed,
  isDark,
  blocks,
  onStartDrag,
  onUpdate,
  onUpdateItem,
  onDelete,
  onToggleDone,
}: {
  placed: Placed;
  isDark: boolean;
  blocks?: Block[];
  /** Hand the bar to the calendar's own drag machinery (ghost + drop). */
  onStartDrag: (e: React.PointerEvent, grabOffsetPx: number) => void;
  onUpdate: (patch: Partial<Step>) => void;
  onUpdateItem?: (id: string, patch: Partial<Item>) => void;
  onDelete: () => void;
  onToggleDone: () => void;
}) {
  const color = placed.item.color ?? placed.block.color;
  const ref = useRef<HTMLButtonElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const done = placed.step.status === "done";
  const name = placed.step.label || placed.item.title;

  // Click vs drag, same idiom as the sidebar tray: a few px of travel hands
  // off to the calendar's snapping ghost drag; a clean release opens the
  // editor. (Threshold keeps an ordinary click from accidentally scheduling.)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    e.stopPropagation();
    const start = e;
    const sx = e.clientX;
    const sy = e.clientY;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) {
        dragged = true;
        cleanup();
        onStartDrag(start, 9);
      }
    };
    const up = () => {
      cleanup();
      if (!dragged) setEditOpen(true);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      <button
        ref={ref}
        onPointerDown={onPointerDown}
        className={cn(
          "block h-[18px] w-full min-w-0 cursor-grab select-none truncate rounded px-1.5 text-left text-[9.5px] font-medium leading-[16.2px] transition [-webkit-user-drag:none] hover:brightness-110 active:cursor-grabbing",
          done && "opacity-50",
        )}
        style={{
          background: color,
          // On the solid block-colour fill, a dark blend is illegible in light
          // mode — use white there; dark mode keeps the light colour tint.
          color: isDark
            ? `color-mix(in srgb, ${color} 35%, white)`
            : "white",
        }}
        title={name}
      >
        <span className={cn(done && "line-through")}>{name}</span>
      </button>
      {editOpen && (
        <EventEditPopover
          anchorRef={ref}
          itemTitle={placed.item.title}
          stepLabel={placed.step.label}
          blockName={placed.block.name}
          blockColor={color}
          blocks={blocks}
          currentBlockId={placed.item.block_id ?? undefined}
          time={placed.step.time_of_day}
          durationMin={placed.step.duration_min}
          isDone={done}
          isRecurring={!!placed.item.recurrence}
          onTimeChange={(t) => onUpdate({ time_of_day: t })}
          onDurationChange={(m) => onUpdate({ duration_min: m })}
          onLabelChange={(label) => onUpdate({ label })}
          onTitleChange={(title) => onUpdateItem?.(placed.item.id, { title })}
          onBlockChange={(blockId) =>
            onUpdateItem?.(placed.item.id, { block_id: blockId })
          }
          onToggleDone={() => {
            onToggleDone();
            setEditOpen(false);
          }}
          onDelete={() => {
            onDelete();
            setEditOpen(false);
          }}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}

function EventBlock({
  placed,
  hourH,
  slotMin,
  snapMin,
  isSelected,
  isDark = false,
  blocks,
  onSelect,
  onUpdate,
  onRepeat,
  onUpdateItem,
  onDelete,
  onToggleDone,
  onStartDrag,
}: {
  placed: LaidOut;
  hourH: number;
  slotMin: number;
  snapMin: (m: number) => number;
  isSelected: boolean;
  isDark: boolean;
  blocks: Block[];
  onSelect: (id: string, mode: SelectMode) => void;
  onUpdate: (patch: Partial<Step>) => void;
  onRepeat?: (time: string) => void;
  onUpdateItem?: (id: string, patch: Partial<Item>) => void;
  onDelete: () => void;
  onToggleDone: () => void;
  onStartDrag: (e: React.PointerEvent, grabOffsetPx: number) => void;
}) {
  const HOUR_H = hourH;
  const SLOT_MIN = slotMin;
  const color = placed.item.color ?? placed.block.color;
  const ref = useRef<HTMLDivElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [localDur, setLocalDur] = useState(placed.durationMin);
  useEffect(() => setLocalDur(placed.durationMin), [placed.durationMin]);

  // Compute end time from start + (live) duration
  const startTime24 = placed.step.time_of_day;
  let endTime24: string | null = null;
  if (startTime24) {
    const m = /^(\d{1,2}):(\d{2})/.exec(startTime24);
    if (m) {
      const totalEnd = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + localDur;
      const eh = Math.floor(totalEnd / 60) % 24;
      const em = totalEnd % 60;
      endTime24 = `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
    }
  }
  const rangeStr = fmtTimeRange12(startTime24, endTime24) ?? "";
  const time12 = fmtTime12(startTime24) ?? "";
  const isAM = time12.endsWith("AM");

  const top = (placed.startMin / 60) * HOUR_H;
  const height = Math.max(20, (localDur / 60) * HOUR_H - 2);
  // Overlapping same-color cards are indistinguishable without a seam —
  // darken the border for any card that rides on another (GCal puts the
  // outline on the overlaying card, not the base full-width one).
  const coexists = placed.depth > 0;
  // Recurring occurrences read as "background rhythm": low-opacity fill
  // with a SOLID full-color border (done = dashed, recurring = solid), so
  // one-off work visually plans itself around them.
  const recurring = !!placed.item.recurrence;
  const done = placed.step.status === "done";

  const tier: "tiny" | "compact" | "full" =
    height < 30 ? "tiny" : height < 56 ? "compact" : "full";

  // Bottom resize
  const resizeRef = useRef<{ y: number; startDur: number } | null>(null);
  function startResize(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { y: e.clientY, startDur: localDur };
  }
  function moveResize(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    const dy = e.clientY - resizeRef.current.y;
    const dMin = (dy / HOUR_H) * 60;
    // Cap at 24h — the server schema rejects duration_min > 1440, and a
    // rejected write is logged and DROPPED (`persist()` does not roll back), so
    // an out-of-range value must never leave the client: it would be lost with
    // nothing in the interface saying so. Same reason `step-row.tsx`'s
    // `commitEffort` clamps.
    const next = Math.min(
      1440,
      Math.max(SLOT_MIN, snapMin(resizeRef.current.startDur + dMin)),
    );
    setLocalDur(next);
  }
  function endResize(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    resizeRef.current = null;
    if (localDur !== placed.durationMin) {
      onUpdate({ duration_min: localDur });
    }
  }

  const onPointerDown = useCardPointer({
    stepId: placed.step.id,
    isSelected,
    onSelect,
    startDrag: onStartDrag,
  });

  const menu = useMenu(() => [
    { label: "Edit…", onClick: () => setEditOpen(true) },
    { label: "Mark done", onClick: onToggleDone },
    {
      label: "Repeat at another time",
      onClick: () => setRepeatOpen(true),
    },
    {
      label: "Clear time (→ TBD)",
      onClick: () => onUpdate({ time_of_day: null }),
    },
    { type: "separator" as const },
    { label: "Delete step", destructive: true, onClick: onDelete },
  ]);

  return (
    <>
      <motion.div
        ref={ref}
        {...menu}
        data-cal-card={placed.step.id}
        onPointerDown={onPointerDown}
        onDoubleClick={() => setEditOpen(true)}
        layout
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.14 }}
        className={cn(
          "group absolute overflow-hidden rounded-md px-2 py-1",
          "cursor-grab active:cursor-grabbing",
          isSelected && "ring-2 ring-accent ring-offset-1 ring-offset-bg",
        )}
        style={{
          top,
          height,
          // The layout emits fractions of the gutter-adjusted column, so
          // the right gutter stays constant however cards coexist.
          left: `calc((100% - ${CARD_RIGHT_GUTTER}px) * ${placed.leftFrac} + 2px)`,
          width: `calc((100% - ${CARD_RIGHT_GUTTER}px) * ${placed.widthFrac} - 4px)`,
          // Selection temporarily lifts a buried card above the stack (20 —
          // over any realistic depth, under the drag ghost's z-30). Click-off
          // deselects, dropping it back to its natural layer.
          zIndex: isSelected ? 20 + placed.depth : placed.depth,
          // Solid fills only. Done/recurring stay as opaque tints (mixed over
          // the theme bg so stacked cards can't bleed through), everything else
          // is the flat block colour.
          backgroundColor: done
            ? `color-mix(in srgb, ${color} 10%, var(--bg))`
            : recurring
              ? `color-mix(in srgb, ${color} 12%, var(--bg))`
              : color,
          // The one border we keep: a seam the colour of the page background
          // (white on light, near-black on dark) on a card that overlaps
          // another, so stacked cards read as separate slabs.
          ...(coexists ? { border: `2px solid var(--bg)` } : {}),
          transition: "background-color 0.5s ease",
        }}
      >
        {/* Recurring: a full-opacity block-colour accent bar down the left edge
            (clipped to the card's rounded corners). */}
        {recurring && (
          <span
            className={cn(
              "pointer-events-none absolute inset-y-0 left-0 z-10 w-1",
              done && "opacity-40",
            )}
            style={{ background: color }}
          />
        )}
        {(() => {
          const done = placed.step.status === "done";
          // colour-transition wrapper so text fades alongside the bg
          const wrapStyle: React.CSSProperties = {
            transition: "color 0.5s ease",
          };
          // Completed tasks get low-opacity theme text ("faded out").
          const doneText = "color-mix(in srgb, var(--text) 45%, transparent)";
          // Recurring text is a dark version of the block colour on light mode
          // (a light version on dark) — colour-forward like Notion, readable on
          // the faded fill, rather than the neutral theme text.
          const recurText = `color-mix(in srgb, ${color} 58%, ${isDark ? "white" : "black"})`;
          const tc = done ? doneText : recurring ? recurText : "rgba(255,255,255,1)";
          const tcs = done ? doneText : recurring ? recurText : "rgba(255,255,255,0.8)";
          const tcd = done ? doneText : recurring ? recurText : "rgba(255,255,255,0.7)";
          const st = done ? "line-through" : undefined;
          const name = placed.step.label || placed.item.title;
          return tier === "tiny" ? (
            <div
              className="flex h-full items-center gap-1.5 text-[9.9px]"
              style={wrapStyle}
            >
              {placed.block.icon ? (
                <span className="shrink-0">
                  <BlockIcon name={placed.block.icon} size={11} color={tcs} />
                </span>
              ) : (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: tcs }}
                />
              )}
              <span
                className="truncate font-semibold"
                style={{ color: tc, textDecoration: st }}
              >
                {name}
              </span>
              <span
                className="ml-auto shrink-0 text-[9px] font-semibold tabular-nums"
                style={{ color: tcs, textDecoration: st }}
              >
                {rangeStr}
              </span>
            </div>
          ) : tier === "compact" ? (
            <div
              className="flex h-full flex-col justify-center gap-0.5"
              style={wrapStyle}
            >
              <div
                className="truncate text-[10.8px] font-semibold leading-tight"
                style={{ color: tc, textDecoration: st }}
              >
                {name}
              </div>
              <div
                className="truncate text-[9.5px] font-semibold tabular-nums"
                style={{ color: tcs, textDecoration: st }}
              >
                {rangeStr}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col gap-0" style={wrapStyle}>
              {/* GCal order: name + time live in the top text strip that
                  the overlap layout protects, so time stays visible under
                  any coexistence. Block identity is the least critical
                  line (color already carries it) — it sinks to the bottom
                  and may be covered by cascading cards. Step label is the
                  card's main line; item title only fills in for label-less
                  steps (calendar-created events store their name on the
                  item). */}
              <div
                className="truncate text-[10.8px] font-semibold leading-tight"
                style={{ color: tc, textDecoration: st }}
              >
                {name}
              </div>
              <div
                className="truncate text-[9.5px] font-semibold tabular-nums"
                style={{ color: tcs, textDecoration: st }}
              >
                {rangeStr}
              </div>
              {/* Block-name footer — temporarily hidden per request. Un-comment
                  to restore.
              <div className="mt-auto flex items-center gap-1">
                {placed.block.icon ? (
                  <BlockIcon name={placed.block.icon} size={11} color={tcd} />
                ) : (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: tcd }}
                  />
                )}
                <span
                  className="truncate text-[9px] font-bold uppercase tracking-wider"
                  style={{ color: tcd, textDecoration: st }}
                >
                  {placed.block.name}
                </span>
              </div>
              */}
            </div>
          );
        })()}

        {/* Bottom resize handle. */}
        <div
          data-resize="true"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-0 left-0 right-0 z-10 h-1.5 cursor-ns-resize opacity-0 transition group-hover:opacity-100 hover:bg-white/30"
          title="Drag to resize duration (saves as effort)"
        />
      </motion.div>
      {editOpen && (
        <EventEditPopover
          anchorRef={ref as React.RefObject<HTMLElement | null>}
          itemTitle={placed.item.title}
          stepLabel={placed.step.label}
          blockName={placed.block.name}
          blockColor={color}
          blocks={blocks}
          currentBlockId={placed.item.block_id ?? undefined}
          time={placed.step.time_of_day}
          durationMin={placed.step.duration_min}
          isDone={placed.step.status === "done"}
          isRecurring={!!placed.item.recurrence}
          onTimeChange={(t) => onUpdate({ time_of_day: t })}
          onDurationChange={(m) => onUpdate({ duration_min: m })}
          onLabelChange={(label) => onUpdate({ label })}
          onTitleChange={(title) => onUpdateItem?.(placed.item.id, { title })}
          onBlockChange={(blockId) =>
            onUpdateItem?.(placed.item.id, { block_id: blockId })
          }
          onToggleDone={() => {
            onToggleDone();
            setEditOpen(false);
          }}
          onDelete={() => {
            onDelete();
            setEditOpen(false);
          }}
          onClose={() => setEditOpen(false)}
        />
      )}
      {repeatOpen && (
        <TimePopover
          anchorRef={ref}
          value={null}
          onSelect={(t) => {
            if (t) onRepeat?.(t);
            setRepeatOpen(false);
          }}
          onClose={() => setRepeatOpen(false)}
        />
      )}
    </>
  );
}

/** Minutes-since-grid-top for `now`, or null when off the visible range. */
function useCurrentMinuteTop(
  startHour: number,
  hours: number,
  hourH: number,
): { top: number; now: Date } | null {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const min = now.getHours() * 60 + now.getMinutes() - startHour * 60;
  if (min < 0 || min > hours * 60) return null;
  return { top: (min / 60) * hourH, now };
}

/** The rounded red time badge in the left gutter (Notion-style), pinned to the
 *  current-time line. */
function CurrentTimeBadge({
  startHour,
  hours,
  hourH,
}: {
  startHour: number;
  hours: number;
  hourH: number;
}) {
  const cur = useCurrentMinuteTop(startHour, hours, hourH);
  if (!cur) return null;
  const hhmm = `${String(cur.now.getHours()).padStart(2, "0")}:${String(
    cur.now.getMinutes(),
  ).padStart(2, "0")}`;
  const label = (fmtTime12(hhmm) ?? "").replace(" ", "");
  return (
    <div
      className="pointer-events-none absolute right-1 z-30 -translate-y-1/2 rounded-md bg-deadline px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white shadow-sm shadow-black/20"
      style={{ top: cur.top }}
    >
      {label}
    </div>
  );
}

/** The current-time line across all day columns: a faint hairline everywhere, an
 *  emphasized segment over today's column, and a rounded vertical tick at today's
 *  start (the two together read as a sideways "T"). */
function CurrentTimeMarker({
  days,
  startHour,
  hours,
  hourH,
}: {
  days: Date[];
  startHour: number;
  hours: number;
  hourH: number;
}) {
  const cur = useCurrentMinuteTop(startHour, hours, hourH);
  if (!cur) return null;
  const todayIndex = days.findIndex((d) => isToday(d));
  const colW = 100 / days.length;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top: cur.top }}
    >
      {/* Faint line across the whole calendar. */}
      <div className="absolute inset-x-0 h-px -translate-y-1/2 bg-deadline/40" />
      {todayIndex >= 0 && (
        <>
          {/* The "T": a thin bar over today's column (top of the T) + a vertical
              pill at its start (the stem). Rather than ring each piece — which
              makes the pill's border cut across the bar where they meet — a
              single page-bg "underlay" (the union of both, slightly larger) sits
              beneath the red fills, giving the whole T ONE seamless outline
              (white on light, near-black on dark). */}
          {/* underlay: bar — ends at the event-block right edge (column minus the
              card gutter), not the full column width. */}
          <div
            className="absolute h-[5.5px] -translate-y-1/2 rounded-full"
            style={{
              left: `calc(${todayIndex * colW}% - 1.5px)`,
              width: `calc(${colW}% - ${CARD_RIGHT_GUTTER + 2 - 3}px)`,
              background: "var(--bg)",
            }}
          />
          {/* underlay: pill */}
          <div
            className="absolute h-[13px] w-[5.5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${todayIndex * colW}%`, background: "var(--bg)" }}
          />
          {/* red fills */}
          <div
            className="absolute h-[2.5px] -translate-y-1/2 rounded-full bg-deadline"
            style={{
              left: `${todayIndex * colW}%`,
              width: `calc(${colW}% - ${CARD_RIGHT_GUTTER + 2}px)`,
            }}
          />
          <div
            className="absolute h-2.5 w-[2.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-deadline"
            style={{ left: `${todayIndex * colW}%` }}
          />
        </>
      )}
    </div>
  );
}
