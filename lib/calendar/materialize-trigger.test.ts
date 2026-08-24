import { describe, expect, it } from "vitest";
import {
  MATERIALIZE_MIN_INTERVAL_MS,
  shouldMaterialize,
} from "./materialize-trigger";

describe("shouldMaterialize", () => {
  it("fires when it has never run this session", () => {
    // `0` is the ref's initial value, not a timestamp — the very first
    // visibility change after the window opens must be able to extend a
    // series, or a machine left open for a week never does.
    expect(shouldMaterialize(0, Date.UTC(2026, 0, 1))).toBe(true);
  });

  it("does not fire a minute after a run", () => {
    const last = Date.UTC(2026, 0, 1, 9, 0, 0);
    expect(shouldMaterialize(last, last + 60_000)).toBe(false);
  });

  it("fires again exactly one interval later — the boundary is inclusive", () => {
    const last = Date.UTC(2026, 0, 1, 9, 0, 0);
    expect(shouldMaterialize(last, last + MATERIALIZE_MIN_INTERVAL_MS)).toBe(
      true,
    );
    // One millisecond short is still too soon, which is what makes the
    // assertion above about the boundary rather than about "roughly 6h".
    expect(
      shouldMaterialize(last, last + MATERIALIZE_MIN_INTERVAL_MS - 1),
    ).toBe(false);
  });

  it("returns false, and does not throw, when the clock moved backwards", () => {
    // A host clock correction after resume: `now` is BEFORE the last run.
    // A negative difference must read as "too soon", never as "overdue" —
    // otherwise a clock that keeps stepping back re-runs the pass on every
    // visibility change.
    const last = Date.UTC(2026, 0, 1, 9, 0, 0);
    expect(shouldMaterialize(last, last - MATERIALIZE_MIN_INTERVAL_MS)).toBe(
      false,
    );
  });
});
