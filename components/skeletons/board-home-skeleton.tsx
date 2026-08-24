import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

/**
 * Route skeleton for `/app` — the board picker (components/boards/board-home.tsx).
 *
 * Reached from every board via the "Boards" breadcrumb, and the page behind it
 * runs four extra stat queries on top of the shared board/settings read, so
 * this is a transition users feel.
 */

/** Contribution grid: 7 day-rows across 26 week-columns, as WeekSummary draws. */
const GIT_ROWS = 7;
const GIT_COLS = 26;

/** Three cards, matching the sm:2 / lg:3 grid the real screen uses. */
const CARDS = [96, 128, 78];

/** Four rows in the "Recent" list. */
const RECENT = [124, 92, 146, 108];

function GitGridSkeleton() {
  return (
    <div
      className="grid gap-[3px]"
      style={{
        gridTemplateColumns: `repeat(${GIT_COLS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${GIT_ROWS}, 1fr)`,
        gridAutoFlow: "column",
      }}
    >
      {/* Static squares, not .wl-skeleton boxes: 182 independently sweeping
       * pseudo-elements would be the most expensive thing on the screen, and
       * the grid reads fine as a quiet backdrop to the shimmering blocks. */}
      {Array.from({ length: GIT_ROWS * GIT_COLS }, (_, i) => (
        <div key={i} className="aspect-square rounded-[2px] bg-surface" />
      ))}
    </div>
  );
}

function BoardCardSkeleton({ titleWidth }: { titleWidth: number }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-bg-elev">
      <Skeleton className="h-48 rounded-none border-b border-border" />
      <div className="flex items-center gap-3 px-4 py-3.5">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3" style={{ width: titleWidth }} />
          <Skeleton className="h-2.5 w-32" />
        </div>
        <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
      </div>
    </div>
  );
}

export function BoardHomeSkeleton() {
  return (
    <SkeletonScreen
      label="Loading your boards"
      className="flex min-h-dvh flex-col bg-bg text-text"
    >
      <header className="sticky top-0 z-50 flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg-elev px-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-md" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ml-1 h-3 w-14" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-20 sm:px-8">
        {/* Week summary: greeting + completion grid. */}
        <Skeleton className="h-6 w-64" />
        <div className="mt-8 rounded-xl border border-border bg-bg-elev p-5">
          <GitGridSkeleton />
          <div className="mt-6 flex items-center gap-10 border-t border-border pt-5">
            {[80, 96, 72].map((w, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-5" style={{ width: w }} />
                <Skeleton className="h-2.5 w-16" />
              </div>
            ))}
          </div>
        </div>

        {/* Quick access. */}
        <div className="mt-14 flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((w, i) => (
            <BoardCardSkeleton key={i} titleWidth={w} />
          ))}
        </div>

        {/* Recent. */}
        <Skeleton className="mt-14 h-4 w-20" />
        <div className="mt-2 overflow-hidden rounded-xl border border-border bg-bg-elev">
          {RECENT.map((w, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}
            >
              <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3" style={{ width: w }} />
                <Skeleton className="h-2.5 w-24" />
              </div>
              <Skeleton className="h-2.5 w-20 shrink-0" />
              <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-2.5 w-44" />
          <div className="flex gap-4">
            {[48, 56, 40].map((w, i) => (
              <Skeleton key={i} className="h-2.5" style={{ width: w }} />
            ))}
          </div>
        </div>
      </footer>
    </SkeletonScreen>
  );
}
