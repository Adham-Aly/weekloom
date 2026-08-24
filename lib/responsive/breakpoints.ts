/**
 * Single source of truth for viewport breakpoints. Used by the
 * `useViewport` hook and by Tailwind-side CSS (kept in sync with the
 * default Tailwind sm/md/lg values so `sm:`/`md:` utility classes match
 * what the hook reports).
 *
 *   mobile  : < 640px        (phones)
 *   tablet  : 640px – 1023px (small tablets, landscape phones)
 *   desktop : ≥ 1024px       (everything else)
 *
 * Why three buckets, not five: any more and consumers have to reason
 * about edge cases that don't really matter. The Gantt has two distinct
 * modes — "fits a phone screen" or doesn't — and tablet is the awkward
 * middle that gets the desktop layout with a few mobile concessions.
 */

export const BREAKPOINTS = {
  /** Below this width is treated as a phone. Matches Tailwind `sm:`. */
  mobile: 640,
  /** Below this width is tablet, above is desktop. Matches Tailwind `lg:`. */
  desktop: 1024,
} as const;

export type ViewportKind = "mobile" | "tablet" | "desktop";

export function viewportFromWidth(width: number): ViewportKind {
  if (width < BREAKPOINTS.mobile) return "mobile";
  if (width < BREAKPOINTS.desktop) return "tablet";
  return "desktop";
}
