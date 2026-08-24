import {
  BLOCK_HEADER_H,
  DATE_ROW_H,
  ITEM_HEADER_H,
  SIDEBAR_W,
  type ViewMode,
} from "@/lib/gantt/constants";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

/**
 * Route skeleton for `/app/<boardId>/<view>` — the heaviest page in the app
 * (up to six auth round trips and ~13 queries before it renders a single
 * pixel, see app/app/[[...slug]]/page.tsx).
 *
 * The geometry is imported from lib/gantt/constants rather than hardcoded, so
 * the placeholder rows land on the same rhythm as the real ones and the swap
 * from skeleton to board is a fade rather than a jump.
 *
 * ⚠️ Every dimension here is fixed data, never Math.random(). This renders on
 * the server first (it is the streamed shell on a hard navigation), so a
 * randomised layout would hydrate to a different one and React would warn.
 */

/** Default step-row height (lib/types/settings.ts DEFAULTS.rowH). */
const ROW_H = 36;

/** Columns drawn in the placeholder grid. Enough to fill a wide screen. */
const DAYS = 14;

/**
 * A fixed, plausible board: three blocks, each with two items, each with two
 * steps. `start`/`span` are grid-column coordinates in the DAYS-wide grid.
 */
const BLOCKS: ReadonlyArray<{
  width: number;
  items: ReadonlyArray<{
    width: number;
    start: number;
    span: number;
    steps: ReadonlyArray<{ width: number; start: number; span: number }>;
  }>;
}> = [
  {
    width: 104,
    items: [
      {
        width: 132,
        start: 0,
        span: 5,
        steps: [
          { width: 96, start: 0, span: 2 },
          { width: 118, start: 2, span: 3 },
        ],
      },
      {
        width: 108,
        start: 3,
        span: 4,
        steps: [
          { width: 124, start: 3, span: 2 },
          { width: 88, start: 5, span: 2 },
        ],
      },
    ],
  },
  {
    width: 86,
    items: [
      {
        width: 146,
        start: 2,
        span: 6,
        steps: [
          { width: 102, start: 2, span: 3 },
          { width: 134, start: 5, span: 3 },
        ],
      },
      {
        width: 96,
        start: 6,
        span: 5,
        steps: [
          { width: 112, start: 6, span: 2 },
          { width: 92, start: 8, span: 3 },
        ],
      },
    ],
  },
  {
    width: 120,
    items: [
      {
        width: 116,
        start: 5,
        span: 4,
        steps: [
          { width: 128, start: 5, span: 2 },
          { width: 84, start: 7, span: 2 },
        ],
      },
      {
        width: 138,
        start: 8,
        span: 5,
        steps: [
          { width: 94, start: 8, span: 3 },
          { width: 120, start: 11, span: 2 },
        ],
      },
    ],
  },
];

/**
 * Vertical day separators, drawn the way the real grid draws them — one
 * repeating background gradient rather than a border per cell.
 */
const GRIDLINES: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, rgba(var(--gridline-rgb), 0.05) 1px, transparent 1px)",
  backgroundSize: `calc(100% / ${DAYS}) 100%`,
};

const GRID_COLUMNS: React.CSSProperties = {
  gridTemplateColumns: `repeat(${DAYS}, minmax(0, 1fr))`,
};

/** The 52px desktop / 48px mobile header, which lives in board.tsx itself. */
function TopBarSkeleton() {
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-elev px-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-md" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="ml-1 h-3 w-14" />
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="ml-1 h-7 w-7 rounded-md" />
        <Skeleton className="h-7 w-7 rounded-md" />
        <div className="mx-1 h-5 w-px bg-border" />
        <Skeleton className="h-7 w-16 rounded-md" />
      </div>
    </header>
  );
}

/** One row: a fixed-width sidebar cell plus its slice of the day grid. */
function GridRow({
  height,
  elevated,
  sidebar,
  children,
}: {
  height: number;
  elevated?: boolean;
  sidebar: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-stretch border-b border-border ${elevated ? "bg-bg-elev" : "bg-bg"}`}
      style={{ height }}
    >
      <div
        className="flex shrink-0 items-center border-r border-border"
        style={{ width: SIDEBAR_W }}
      >
        {sidebar}
      </div>
      <div
        className="relative grid flex-1"
        style={{ ...GRID_COLUMNS, ...GRIDLINES }}
      >
        {children}
      </div>
    </div>
  );
}

/** A placeholder task bar occupying `span` day columns from `start`. */
function Bar({ start, span }: { start: number; span: number }) {
  return (
    <div
      className="flex items-center px-1"
      style={{ gridColumn: `${start + 1} / span ${span}` }}
    >
      <Skeleton className="h-4 w-full rounded-full" />
    </div>
  );
}

function GanttSkeleton() {
  return (
    <>
      {/* Month bar — the range label and view controls above the grid. */}
      <div className="flex shrink-0 items-stretch border-b border-border bg-bg-elev">
        <div
          className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-2"
          style={{ width: SIDEBAR_W }}
        >
          <Skeleton className="h-6 w-20 rounded-md" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
        <div className="flex flex-1 items-center gap-3 py-2 pl-4 pr-3">
          <Skeleton className="h-4 w-40" />
          <div className="ml-auto flex items-center gap-1.5">
            <Skeleton className="h-6 w-16 rounded-md" />
            <Skeleton className="h-6 w-14 rounded-md" />
            <Skeleton className="h-6 w-6 rounded-md" />
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {/* Date header. */}
        <GridRow
          height={DATE_ROW_H}
          elevated
          sidebar={
            <div className="flex w-full items-center gap-2 px-4">
              <Skeleton className="h-3 w-24" />
            </div>
          }
        >
          {Array.from({ length: DAYS }, (_, i) => (
            <div key={i} className="flex items-center justify-center">
              <Skeleton className="h-2.5 w-8" />
            </div>
          ))}
        </GridRow>

        {BLOCKS.map((block, bi) => (
          <div key={bi}>
            <GridRow
              height={BLOCK_HEADER_H}
              elevated
              sidebar={
                <div className="flex w-full items-center gap-2 px-4">
                  <Skeleton className="h-3 w-3 rounded-sm" />
                  <Skeleton className="h-3" style={{ width: block.width }} />
                </div>
              }
            />
            {block.items.map((item, ii) => (
              <div key={ii}>
                <GridRow
                  height={ITEM_HEADER_H}
                  sidebar={
                    <div className="flex w-full items-center gap-2 px-4">
                      <Skeleton className="h-3 w-3 rounded-sm" />
                      <Skeleton className="h-3" style={{ width: item.width }} />
                    </div>
                  }
                >
                  <Bar start={item.start} span={item.span} />
                </GridRow>
                {item.steps.map((step, si) => (
                  <GridRow
                    key={si}
                    height={ROW_H}
                    sidebar={
                      <div className="flex w-full items-center gap-1.5 pl-[54px] pr-2">
                        <Skeleton className="h-3 w-3 rounded-full" />
                        <Skeleton
                          className="h-2.5"
                          style={{ width: step.width }}
                        />
                      </div>
                    }
                  >
                    <Bar start={step.start} span={step.span} />
                  </GridRow>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/** Time-gutter width in the Week/Day grid (calendar.tsx TIME_COL_W). */
const TIME_COL_W = 64;

function CalendarSkeleton({ days }: { days: number }) {
  return (
    <div className="flex min-h-0 flex-1">
      {/* The Week/Day sidebar: mini month, unscheduled list, calendar list. */}
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-border bg-bg-elev p-4 sm:flex">
        <Skeleton className="h-40 w-full rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          {[136, 108, 152, 96].map((w, i) => (
            <Skeleton key={i} className="h-7 rounded-md" style={{ width: w }} />
          ))}
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          {[120, 144].map((w, i) => (
            <Skeleton key={i} className="h-6 rounded-md" style={{ width: w }} />
          ))}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col bg-bg">
        <div className="flex shrink-0 items-center gap-3 py-2 pl-4 pr-3">
          <Skeleton className="h-4 w-36" />
          <div className="ml-auto flex items-center gap-1.5">
            <Skeleton className="h-6 w-16 rounded-md" />
            <Skeleton className="h-6 w-6 rounded-md" />
            <Skeleton className="h-6 w-6 rounded-md" />
          </div>
        </div>

        {/* Day header row, on the same 36px rhythm as the Gantt date header. */}
        <div
          className="flex shrink-0 items-stretch border-b border-border bg-bg-elev"
          style={{ height: DATE_ROW_H }}
        >
          <div
            className="shrink-0 border-r border-border"
            style={{ width: TIME_COL_W }}
          />
          <div
            className="grid flex-1"
            style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: days }, (_, i) => (
              <div
                key={i}
                className="flex items-center justify-center border-l border-border"
              >
                <Skeleton className="h-2.5 w-10" />
              </div>
            ))}
          </div>
        </div>

        {/* Hour grid with a few placeholder event cards. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div
            className="shrink-0 space-y-8 border-r border-border pr-2 pt-2"
            style={{ width: TIME_COL_W }}
          >
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="ml-auto h-2.5 w-9" />
            ))}
          </div>
          <div
            className="grid flex-1"
            style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: days }, (_, col) => (
              <div key={col} className="space-y-3 border-l border-border p-1.5">
                {/* A fixed per-column cadence keeps the render deterministic. */}
                <Skeleton
                  className="w-full rounded-md"
                  style={{
                    height: 44 + ((col * 17) % 40),
                    marginTop: (col * 23) % 60,
                  }}
                />
                <Skeleton
                  className="w-full rounded-md"
                  style={{
                    height: 32 + ((col * 11) % 28),
                    marginTop: (col * 13) % 48,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BoardSkeleton({ view }: { view: ViewMode }) {
  return (
    <SkeletonScreen
      label="Loading your board"
      className="relative flex h-screen flex-col bg-bg text-text"
    >
      <TopBarSkeleton />
      {view === "gantt" ? (
        <GanttSkeleton />
      ) : (
        <CalendarSkeleton days={view === "day" ? 1 : 7} />
      )}
    </SkeletonScreen>
  );
}
