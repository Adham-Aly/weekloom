// Calendar overlap layout, reverse-engineered from Google Calendar's week
// view.
//
// GCal never splits a column into disjoint lanes — every overlapping card
// STAGGERS: it starts some fraction to the right of each card beneath it,
// extends all the way to the column's right edge, and renders on top
// (later start above earlier; for identical starts, shorter above
// longer). The stagger fraction per underlying card depends on how far
// down the new card's top edge lands, measured in PIXELS so it tracks the
// user's hour-height zoom.
//
// Cards protect a TEXT STRIP at their top: name line + time line (which
// is exactly why the card renders time directly under the name — GCal's
// "time is always visible" philosophy falls out of guarding that strip).
// For a later event B overlapping an earlier event A:
//
//   gap < CASCADE_MIN_PX    RIVAL — B's top lands on A's name line
//                           (same-start case). B starts a third of the
//                           way into A, clipping A's text mid-word the
//                           way GCal does.
//   gap < CASCADE_CLEAR_PX  SQUISH — B's top edge cuts through A's time
//                           line, so B is shoved right past most of A's
//                           text width (a small clip of A's trailing
//                           characters is accepted).
//   otherwise               NOTCH — A's name + time sit fully above B's
//                           top edge; B indents a small notch and takes
//                           the rest of the width.
//
// One pass composes every scenario: same-start rivals, staircase chains
// (offsets compound card by card), nested siblings that don't overlap
// each other inside one long parent (both notch into the same span),
// rivals-of-a-child (stagger within the child's span), and containment
// (B inside A follows the same gap rules). `depth` is the z-order;
// renderers put a darkened border seam on any card with depth > 0.

export const CASCADE_MIN_PX = 20;
export const CASCADE_CLEAR_PX = 36;
export const RIVAL_FRAC = 1 / 3;
export const SQUISH_FRAC = 0.55;
export const NOTCH_FRAC = 0.06;

export type OverlapLaidOut<T> = T & {
  /** Stacking order — number of layers beneath this card (0 = base). */
  depth: number;
  /** Left edge / width as fractions (0..1) of the usable column width. */
  leftFrac: number;
  widthFrac: number;
};

export function layoutOverlaps<
  T extends { startMin: number; durationMin: number },
>(events: T[], hourH: number): Array<OverlapLaidOut<T>> {
  const pxPerMin = hourH / 60;
  // Earlier starts lay out first; identical starts put the longer event
  // underneath (GCal renders the shorter one on top).
  const sorted = [...events].sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    return b.durationMin - a.durationMin;
  });
  type W = OverlapLaidOut<T> & { endMin: number };
  const laid: W[] = [];
  for (const ev of sorted) {
    const endMin = ev.startMin + ev.durationMin;
    let leftFrac = 0;
    let depth = 0;
    for (const o of laid) {
      if (!(o.endMin > ev.startMin && o.startMin < endMin)) continue;
      const gap = (ev.startMin - o.startMin) * pxPerMin;
      const frac =
        gap < CASCADE_MIN_PX
          ? RIVAL_FRAC
          : gap < CASCADE_CLEAR_PX
            ? SQUISH_FRAC
            : NOTCH_FRAC;
      leftFrac = Math.max(leftFrac, o.leftFrac + o.widthFrac * frac);
      depth = Math.max(depth, o.depth + 1);
    }
    laid.push({ ...ev, endMin, depth, leftFrac, widthFrac: 1 - leftFrac });
  }
  return laid;
}
