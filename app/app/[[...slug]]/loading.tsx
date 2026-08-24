"use client";

import { usePathname } from "next/navigation";
import type { ViewMode } from "@/lib/gantt/constants";
import { BoardHomeSkeleton } from "@/components/skeletons/board-home-skeleton";
import { BoardSkeleton } from "@/components/skeletons/board-skeleton";

/**
 * Suspense fallback for every `/app/...` URL. This one segment serves two very
 * different surfaces — the board picker and an open board — so the skeleton
 * has to know which one it is standing in for.
 *
 * ⚠️ A loading.tsx receives no props in the App Router: there is no `params`
 * to read the slug from. The destination is therefore recovered from the
 * pathname, which is why this file is a Client Component. During a client
 * transition the router has already committed the new URL by the time the
 * fallback renders, and on a hard navigation the streamed shell is rendered
 * for the requested path, so both entry paths resolve correctly.
 *
 * ⚠️ The branch below is a mirror of `parseSlug` in page.tsx — same UUID-first
 * rule, same view keywords, same "gantt" default. If that parser changes, this
 * must change with it, or the wrong skeleton shows for a beat. Worst case is
 * cosmetic: both surfaces open on the same background with a ~4px header
 * height difference, so a mismatch reads as a settle, not a flash.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AppLoading() {
  const pathname = usePathname();
  // ["app", <boardId?>, <view?>, <date?>] → drop the leading "app".
  const slug = pathname.split("/").filter(Boolean).slice(1);

  const hasBoard = slug.length > 0 && UUID_RE.test(slug[0]);
  if (!hasBoard) return <BoardHomeSkeleton />;

  const viewSeg = slug[1];
  const view: ViewMode =
    viewSeg === "week" ? "week" : viewSeg === "day" ? "day" : "gantt";

  return <BoardSkeleton view={view} />;
}
