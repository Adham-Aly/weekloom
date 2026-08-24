import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

/**
 * Route skeleton for `/settings`.
 *
 * The page (components/settings-form.tsx) is a two-pane shell: a fixed 14rem
 * category rail and a max-w-3xl body of label/control rows. The numbers below
 * mirror that layout so the swap reads as a settle rather than a jump — they
 * are fixed data, never randomised, because this renders on the server first
 * and a randomised layout would hydrate to a different one.
 */

function SettingsHeaderSkeleton() {
  return (
    <header className="sticky top-0 z-50 flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg-elev px-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-md" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="ml-1 h-3 w-14" />
      </div>
      <Skeleton className="h-3 w-12" />
    </header>
  );
}

/** Category rail: three groups, mirroring Preferences / Board / General. */
const NAV_GROUPS: ReadonlyArray<readonly number[]> = [[72, 88], [56, 80], [68]];

/** Sections in the body, each `[headingWidth, rowCount]` — one per nav item. */
const SECTIONS: ReadonlyArray<readonly [number, number]> = [
  [92, 4],
  [116, 6],
  [72, 8],
  [96, 8],
  [80, 2],
];

function SettingsRowSkeleton() {
  return (
    <div className="grid gap-x-10 gap-y-3 py-6 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-2.5 w-40" />
      </div>
      <Skeleton className="h-9 w-full max-w-xs rounded-md" />
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <SkeletonScreen
      label="Loading settings"
      className="flex h-screen flex-col bg-bg text-text"
    >
      <SettingsHeaderSkeleton />

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-56 shrink-0 space-y-6 border-r border-border px-3 py-6 sm:block">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="space-y-1.5">
              <Skeleton className="mb-2 ml-3 h-2.5 w-16" />
              {group.map((w, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2"
                >
                  <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
                  <Skeleton className="h-3" style={{ width: w }} />
                </div>
              ))}
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-hidden">
          <div className="mx-auto w-full max-w-3xl space-y-14 px-6 py-9 sm:px-10">
            {SECTIONS.map(([headingWidth, rows], si) => (
              <section key={si}>
                <Skeleton className="h-4" style={{ width: headingWidth }} />
                <div className="mt-2 divide-y divide-border">
                  {Array.from({ length: rows }, (_, i) => (
                    <SettingsRowSkeleton key={i} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </main>
      </div>
    </SkeletonScreen>
  );
}
