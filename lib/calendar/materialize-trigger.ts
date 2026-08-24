export const MATERIALIZE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Should the board extend its recurring series right now?
 *
 * `instrumentation.ts` already ran one pass at launch, so this exists only for
 * an app left open past the materialisation window. Six hours because the pass
 * is idempotent and cheap (a planner pass plus a `WHERE NOT EXISTS` insert per
 * missing occurrence), so running it too often costs milliseconds while running
 * it too rarely costs a series that quietly stops.
 *
 * `lastRunMs === 0` means "never run in this session" and always fires. A clock
 * that has moved BACKWARDS (`nowMs < lastRunMs` — a manual change, a DST-naive
 * host clock, a laptop resuming from sleep with a corrected time) yields a
 * negative difference, which is below the interval, so it does not fire: the
 * next forward tick past the watermark will. Answering "yes" there would let a
 * clock that keeps stepping backwards run the pass on every visibility change.
 *
 * This lives in `lib/` rather than inline in the board component because
 * `components/**` is outside vitest's include — a predicate written there is a
 * predicate nothing checks.
 */
export function shouldMaterialize(lastRunMs: number, nowMs: number): boolean {
  return lastRunMs === 0 || nowMs - lastRunMs >= MATERIALIZE_MIN_INTERVAL_MS;
}
