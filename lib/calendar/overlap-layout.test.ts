import { describe, expect, it } from "vitest";
import {
  layoutOverlaps,
  CASCADE_MIN_PX,
  CASCADE_CLEAR_PX,
  RIVAL_FRAC,
  SQUISH_FRAC,
  NOTCH_FRAC,
} from "./overlap-layout";

// hourH = 60 → 1px per minute, so minute gaps read directly as px gaps.
const H = 60;
const ev = (startMin: number, durationMin: number, id?: string) => ({
  id: id ?? `${startMin}-${durationMin}`,
  startMin,
  durationMin,
});
const byId = <T extends { id: string }>(laid: T[], id: string) => {
  const found = laid.find((e) => e.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

describe("layoutOverlaps — GCal coexistence scenarios", () => {
  it("lone event spans the full column", () => {
    const [a] = layoutOverlaps([ev(540, 60)], H);
    expect(a).toMatchObject({ depth: 0, leftFrac: 0, widthFrac: 1 });
  });

  it("non-overlapping events both span the full column", () => {
    const laid = layoutOverlaps([ev(540, 30, "a"), ev(600, 30, "b")], H);
    for (const e of laid) {
      expect(e).toMatchObject({ depth: 0, leftFrac: 0, widthFrac: 1 });
    }
  });

  it("same start = rivals: later card staggers a third in, on top (no disjoint split)", () => {
    const laid = layoutOverlaps([ev(540, 105, "a"), ev(540, 105, "b")], H);
    const a = byId(laid, "a");
    const b = byId(laid, "b");
    expect(a).toMatchObject({ depth: 0, leftFrac: 0, widthFrac: 1 });
    expect(b.depth).toBe(1);
    expect(b.leftFrac).toBeCloseTo(RIVAL_FRAC);
    expect(b.widthFrac).toBeCloseTo(1 - RIVAL_FRAC);
  });

  it("identical starts stack the shorter card on top of the longer", () => {
    const laid = layoutOverlaps([ev(540, 30, "short"), ev(540, 180, "long")], H);
    expect(byId(laid, "long").depth).toBe(0);
    expect(byId(laid, "short").depth).toBe(1);
  });

  it("gap inside the text strip = squish past most of the base card's text", () => {
    const gap = CASCADE_MIN_PX + 5; // < CASCADE_CLEAR_PX
    const laid = layoutOverlaps([ev(540, 120, "a"), ev(540 + gap, 120, "b")], H);
    const b = byId(laid, "b");
    expect(b.depth).toBe(1);
    expect(b.leftFrac).toBeCloseTo(SQUISH_FRAC);
  });

  it("gap clearing the text strip = small notch, near-full width", () => {
    const gap = CASCADE_CLEAR_PX + 10;
    const laid = layoutOverlaps([ev(540, 300, "a"), ev(540 + gap, 60, "b")], H);
    const b = byId(laid, "b");
    expect(b.depth).toBe(1);
    expect(b.leftFrac).toBeCloseTo(NOTCH_FRAC);
    expect(b.widthFrac).toBeCloseTo(1 - NOTCH_FRAC);
  });

  it("staircase chain compounds offsets card by card", () => {
    const g = CASCADE_CLEAR_PX + 10;
    const laid = layoutOverlaps(
      [ev(0, 300, "a"), ev(g, 300 - g, "b"), ev(2 * g, 300 - 2 * g, "c")],
      H,
    );
    const b = byId(laid, "b");
    const c = byId(laid, "c");
    expect(b.leftFrac).toBeCloseTo(NOTCH_FRAC);
    // c hangs off both a (notch from 0) and b (notch from b's left edge);
    // b's constraint is the binding one.
    expect(c.depth).toBe(2);
    expect(c.leftFrac).toBeCloseTo(
      b.leftFrac + b.widthFrac * NOTCH_FRAC,
    );
  });

  it("nested siblings inside one long parent reuse the same span", () => {
    // The user's GCal screenshot: 7:30–13:00 parent, 9:15–10:30 and
    // 10:45–12:15 children that don't overlap each other.
    const laid = layoutOverlaps(
      [ev(0, 330, "parent"), ev(105, 75, "kid1"), ev(195, 90, "kid2")],
      H,
    );
    const k1 = byId(laid, "kid1");
    const k2 = byId(laid, "kid2");
    expect(k1).toMatchObject({ depth: 1 });
    expect(k2).toMatchObject({ depth: 1 });
    expect(k1.leftFrac).toBeCloseTo(NOTCH_FRAC);
    expect(k2.leftFrac).toBeCloseTo(NOTCH_FRAC);
  });

  it("rival of a child staggers within the child's span", () => {
    const g = CASCADE_CLEAR_PX + 10;
    const laid = layoutOverlaps(
      [ev(0, 300, "parent"), ev(g, 100, "kid"), ev(g + 5, 100, "rival")],
      H,
    );
    const kid = byId(laid, "kid");
    const rival = byId(laid, "rival");
    expect(rival.depth).toBe(2);
    // Binding constraint: a third into the kid (5px gap = rival), which
    // outweighs the parent's notch.
    expect(rival.leftFrac).toBeCloseTo(
      kid.leftFrac + kid.widthFrac * RIVAL_FRAC,
    );
  });

  it("containment (B fully inside A) follows the same gap rules", () => {
    const gap = CASCADE_CLEAR_PX + 20;
    const laid = layoutOverlaps([ev(0, 300, "a"), ev(gap, 30, "b")], H);
    expect(byId(laid, "b").leftFrac).toBeCloseTo(NOTCH_FRAC);
  });

  it("thresholds are pixel-based: the same minute gap changes mode with zoom", () => {
    const events = () => [ev(540, 120, "a"), ev(570, 120, "b")]; // 30 min gap
    // 30px gap → squish
    const squished = byId(layoutOverlaps(events(), 60), "b");
    expect(squished.leftFrac).toBeCloseTo(SQUISH_FRAC);
    // 60px gap → clears the strip → notch
    const notched = byId(layoutOverlaps(events(), 120), "b");
    expect(notched.leftFrac).toBeCloseTo(NOTCH_FRAC);
    // 15px gap → rival stagger
    const rival = byId(layoutOverlaps(events(), 30), "b");
    expect(rival.leftFrac).toBeCloseTo(RIVAL_FRAC);
  });

  it("touching events (A ends when B starts) do not constrain each other", () => {
    const laid = layoutOverlaps([ev(540, 60, "a"), ev(600, 60, "b")], H);
    expect(byId(laid, "b")).toMatchObject({ leftFrac: 0, depth: 0 });
  });

  it("empty input yields empty output", () => {
    expect(layoutOverlaps([], H)).toEqual([]);
  });
});
