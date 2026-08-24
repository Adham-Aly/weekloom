import { describe, expect, it } from "vitest";
import { daysBetweenISO, occurrenceOffsets } from "./recurrence";
import type { Recurrence } from "@/lib/types/database";

// 2026-07-13 is a Monday (getDay() === 1).
const MONDAY = "2026-07-13";
const rule = (days: number[], until?: string): Recurrence => ({
  days,
  time: "08:00",
  durationMin: 15,
  ...(until ? { until } : {}),
});

describe("daysBetweenISO", () => {
  it("computes signed whole-day differences", () => {
    expect(daysBetweenISO("2026-07-13", "2026-07-20")).toBe(7);
    expect(daysBetweenISO("2026-07-20", "2026-07-13")).toBe(-7);
    expect(daysBetweenISO("2026-07-13", "2026-07-13")).toBe(0);
  });
});

describe("occurrenceOffsets", () => {
  it("MWF from a Monday start fires 0,2,4 then repeats weekly", () => {
    // Mon=1, Wed=3, Fri=5
    expect(occurrenceOffsets(MONDAY, rule([1, 3, 5]), 0, 13)).toEqual([
      0, 2, 4, 7, 9, 11,
    ]);
  });

  it("start day outside the rule waits for the first matching weekday", () => {
    // Start Monday, rule = Sundays only (0) → first hit is offset 6.
    expect(occurrenceOffsets(MONDAY, rule([0]), 0, 13)).toEqual([6, 13]);
  });

  it("every offset lands on a wanted weekday", () => {
    const days = [2, 6]; // Tue, Sat
    const offs = occurrenceOffsets(MONDAY, rule(days), 0, 60);
    for (const o of offs) {
      expect(days).toContain((1 + o) % 7);
    }
    expect(offs.length).toBeGreaterThan(0);
  });

  it("fromOffset resumes mid-series without re-listing old occurrences", () => {
    const full = occurrenceOffsets(MONDAY, rule([1, 3, 5]), 0, 27);
    const tail = occurrenceOffsets(MONDAY, rule([1, 3, 5]), 14, 27);
    expect(tail).toEqual(full.filter((o) => o >= 14));
  });

  it("until clamps the series end, inclusively", () => {
    // until = the second Monday (offset 7).
    expect(occurrenceOffsets(MONDAY, rule([1], "2026-07-20"), 0, 60)).toEqual([
      0, 7,
    ]);
  });

  it("negative fromOffset is clamped to the series start", () => {
    expect(occurrenceOffsets(MONDAY, rule([1]), -14, 7)).toEqual([0, 7]);
  });

  it("daily rule fires every day", () => {
    expect(occurrenceOffsets(MONDAY, rule([0, 1, 2, 3, 4, 5, 6]), 0, 6)).toEqual(
      [0, 1, 2, 3, 4, 5, 6],
    );
  });

  it("empty days yields nothing", () => {
    expect(occurrenceOffsets(MONDAY, rule([]), 0, 30)).toEqual([]);
  });
});
