import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { parseDateInput } from "./parse-date";

// Pin "today" so weekday/relative tests are deterministic.
const FIXED_TODAY = new Date(2026, 4, 23); // 2026-05-23, a Saturday

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TODAY);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("parseDateInput", () => {
  it("returns null for empty / unrecognized input", () => {
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput("   ")).toBeNull();
    expect(parseDateInput("nonsense gibberish")).toBeNull();
  });

  describe("named days", () => {
    it("today / now", () => {
      expect(parseDateInput("today")).toBe("2026-05-23");
      expect(parseDateInput("now")).toBe("2026-05-23");
    });
    it("tomorrow + abbreviations", () => {
      expect(parseDateInput("tomorrow")).toBe("2026-05-24");
      expect(parseDateInput("tmrw")).toBe("2026-05-24");
      expect(parseDateInput("tmr")).toBe("2026-05-24");
    });
    it("yesterday", () => {
      expect(parseDateInput("yesterday")).toBe("2026-05-22");
    });
  });

  describe("bare semantic phrases", () => {
    it("next/last/this week", () => {
      expect(parseDateInput("next week")).toBe("2026-05-30");
      expect(parseDateInput("last week")).toBe("2026-05-16");
      expect(parseDateInput("this week")).toBe("2026-05-23");
    });
    it("next/last month", () => {
      expect(parseDateInput("next month")).toBe("2026-06-23");
      expect(parseDateInput("last month")).toBe("2026-04-23");
    });
    it("next/last year", () => {
      expect(parseDateInput("next year")).toBe("2027-05-23");
      expect(parseDateInput("last year")).toBe("2025-05-23");
    });
    it("weekend → next Saturday", () => {
      // 2026-05-23 is a Saturday; weekend returns the *next* Saturday.
      expect(parseDateInput("weekend")).toBe("2026-05-30");
      expect(parseDateInput("this weekend")).toBe("2026-05-30");
    });
  });

  describe("`in a X` / `a X ago`", () => {
    it("in a day/week/month/year", () => {
      expect(parseDateInput("in a day")).toBe("2026-05-24");
      expect(parseDateInput("in a week")).toBe("2026-05-30");
      expect(parseDateInput("in a month")).toBe("2026-06-23");
      expect(parseDateInput("in a year")).toBe("2027-05-23");
    });
    it("a week/month/year ago", () => {
      expect(parseDateInput("a day ago")).toBe("2026-05-22");
      expect(parseDateInput("a week ago")).toBe("2026-05-16");
      expect(parseDateInput("a month ago")).toBe("2026-04-23");
      expect(parseDateInput("a year ago")).toBe("2025-05-23");
    });
  });

  describe("numeric relative", () => {
    it("in N days/weeks/months", () => {
      expect(parseDateInput("in 3 days")).toBe("2026-05-26");
      expect(parseDateInput("in 2 weeks")).toBe("2026-06-06");
      expect(parseDateInput("in 1 month")).toBe("2026-06-23");
    });
    it("N days/weeks/months ago", () => {
      expect(parseDateInput("3 days ago")).toBe("2026-05-20");
      expect(parseDateInput("2 weeks ago")).toBe("2026-05-09");
      expect(parseDateInput("1 month ago")).toBe("2026-04-23");
    });
  });

  describe("weekdays", () => {
    it("bare weekday → next occurrence", () => {
      // Today is Saturday; next Monday is 2026-05-25.
      expect(parseDateInput("monday")).toBe("2026-05-25");
      expect(parseDateInput("mon")).toBe("2026-05-25");
      expect(parseDateInput("friday")).toBe("2026-05-29");
    });
    it("`next monday` matches bare `monday`", () => {
      expect(parseDateInput("next monday")).toBe(parseDateInput("monday"));
    });
    it("`last friday`", () => {
      expect(parseDateInput("last friday")).toBe("2026-05-22");
    });
  });

  describe("explicit date formats", () => {
    it("ISO YYYY-MM-DD", () => {
      expect(parseDateInput("2025-06-05")).toBe("2025-06-05");
    });
    it("M/D and M/D/YYYY", () => {
      expect(parseDateInput("6/5")).toBe("2026-06-05");
      expect(parseDateInput("6/5/2025")).toBe("2025-06-05");
      expect(parseDateInput("6/5/25")).toBe("2025-06-05");
    });
    it("rejects invalid month/day", () => {
      expect(parseDateInput("13/1")).toBeNull();
      expect(parseDateInput("0/15")).toBeNull();
    });
    it("month name + day, no year → rolls forward if past", () => {
      // March 1 has already happened — rolls to 2027.
      expect(parseDateInput("march 1")).toBe("2027-03-01");
      // June 5 is in the future — stays in 2026.
      expect(parseDateInput("june 5")).toBe("2026-06-05");
      expect(parseDateInput("jun 5")).toBe("2026-06-05");
    });
    it("day-first month name", () => {
      expect(parseDateInput("5 june")).toBe("2026-06-05");
      expect(parseDateInput("5 jun, 2025")).toBe("2025-06-05");
    });
  });
});
