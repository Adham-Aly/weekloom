import { redirect } from "next/navigation";
import { GanttBoard } from "@/components/gantt/board";
import { BoardHomeScreen } from "./board-home-screen";
import { Providers } from "@/app/providers";
import { getHomeStats, seedIfEmpty } from "@/app/actions";
import { mergeSettings } from "@/lib/types/settings";
import { listBoards } from "@/lib/db/boards";
import { listBlocksByBoard } from "@/lib/db/blocks";
import { listItemsByBoard } from "@/lib/db/items";
import { listStepsByBoard } from "@/lib/db/steps";
import { listDeadlinesByBoard } from "@/lib/db/deadlines";
import { readSettings } from "@/lib/db/settings";
import type { ViewMode } from "@/lib/gantt/constants";

/**
 * ⚠️ Belt-and-braces alongside `app/settings/page.tsx`'s mandatory one. An
 * optional catch-all with no `generateStaticParams` is already treated as
 * dynamic by Next, but every read on this page is a synchronous function call
 * rather than a dynamic API, so nothing else here would stop a future Next
 * version deciding it could be prerendered — and a prerendered board page
 * serves the build machine's database forever, invisibly in `npm run dev`.
 */
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Board-aware routing: `/app/<boardId>/<view>[/<date>]`.
 *  - slug[0] = boardId (a UUID). Absent => the HOME SCREEN.
 *  - slug[1] = view ("gantt" | "week" | "day"). Defaults to "gantt".
 *  - slug[2] = date (YYYY-MM-DD) for day view.
 *
 * Disambiguation is clean because the board id is always first and is a UUID;
 * the view keyword follows it. A non-UUID first segment (e.g. an old
 * `/app/gantt` link) yields `boardId: null`, which the page redirects.
 *
 * ⚠️ `loading.tsx` in this directory MIRRORS this parser — a `loading.tsx`
 * receives no props, so it recovers the destination from `usePathname()`.
 * Change one and the other must change with it.
 */
function parseSlug(slug?: string[]): {
  boardId: string | null;
  view: ViewMode;
  date?: string;
} {
  if (!slug || slug.length === 0) return { boardId: null, view: "gantt" };
  const boardId = UUID_RE.test(slug[0]) ? slug[0] : null;
  const viewSeg = slug[1];
  const view: ViewMode =
    viewSeg === "week" ? "week" : viewSeg === "day" ? "day" : "gantt";
  return { boardId, view, date: view === "day" ? slug[2] : undefined };
}

export default async function AppPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const { boardId, view, date } = parseSlug(slug);

  // First-run bootstrap: a board, its Completed lane, and a General lane.
  // Idempotent on every launch — its guards are `WHERE NOT EXISTS` predicates,
  // so a lane someone deliberately deleted does not come back.
  await seedIfEmpty();

  // ⚠️ Every board, ARCHIVED ONES INCLUDED. The home screen splits this same
  // array into its Active and Trash tabs, so filtering here would empty the
  // Trash and make archiving irreversible with no route back.
  const boards = listBoards();
  const settings = mergeSettings(readSettings());

  // The persisted active board (set via setActiveBoard), validated against
  // what still exists and is not archived; falls back to the first live board.
  const persistedActive =
    boards.find((b) => b.id === settings.activeBoardId && !b.archived)?.id ??
    null;
  const firstBoardId = boards.find((b) => !b.archived)?.id ?? null;

  // ─── HOME SCREEN ──────────────────────────────────────────────────────
  // Bare `/app` (no board segment) is the Drive-style landing: a grid of the
  // user's boards. The board itself lives at `/app/<id>/<view>`.
  if (!boardId) {
    const stats = await getHomeStats();
    return (
      <Providers>
        <BoardHomeScreen
          initialBoards={boards}
          activeBoardId={persistedActive ?? firstBoardId}
          stats={stats}
          settings={settings}
        />
      </Providers>
    );
  }

  // ─── A SPECIFIC BOARD ─────────────────────────────────────────────────
  // ⚠️ `redirect("/app")`, not `notFound()`: a bookmark to a board that has
  // since been deleted should land on the board list, not on a 404 that offers
  // nowhere to go.
  const activeBoard = boards.find((b) => b.id === boardId) ?? null;
  if (!activeBoard) redirect("/app");

  // Each data table carries `board_id`, so each load is a flat array and a
  // single equality — no joins.
  return (
    <Providers>
      <GanttBoard
        initialBlocks={listBlocksByBoard(activeBoard.id)}
        initialItems={listItemsByBoard(activeBoard.id)}
        initialSteps={listStepsByBoard(activeBoard.id)}
        initialDeadlines={listDeadlinesByBoard(activeBoard.id)}
        settings={settings}
        initialBoards={boards}
        activeBoardId={activeBoard.id}
        activeBoard={activeBoard}
        initialView={view}
        initialDayViewDate={date ?? null}
      />
    </Providers>
  );
}
