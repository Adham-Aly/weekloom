import { describe, expect, it } from "vitest";
import {
  effectiveDeadlineOffset,
  fmtTime12,
  fmtTimeRange12,
  parseFlexTime,
  toISODate,
} from "./utils";

describe("effectiveDeadlineOffset", () => {
  it("returns the stored value when no steps", () => {
    expect(effectiveDeadlineOffset(5, [])).toBe(5);
  });
  it("floors at the last step day (deadline can sit on the same day)", () => {
    expect(effectiveDeadlineOffset(3, [0, 1, 5])).toBe(5);
  });
  it("never drifts backward", () => {
    expect(effectiveDeadlineOffset(10, [0, 1, 2])).toBe(10);
  });
});

describe("parseFlexTime", () => {
  it("parses 24h times", () => {
    expect(parseFlexTime("09:30")).toBe("09:30");
    expect(parseFlexTime("21:00")).toBe("21:00");
    expect(parseFlexTime("0:00")).toBe("00:00");
  });
  it("parses 12h times", () => {
    expect(parseFlexTime("9:30 AM")).toBe("09:30");
    expect(parseFlexTime("9 PM")).toBe("21:00");
    expect(parseFlexTime("12 AM")).toBe("00:00");
    expect(parseFlexTime("12 PM")).toBe("12:00");
  });
  it("rejects invalid input", () => {
    expect(parseFlexTime("")).toBeNull();
    expect(parseFlexTime("25:00")).toBeNull();
    expect(parseFlexTime("9:99")).toBeNull();
    expect(parseFlexTime("13 PM")).toBeNull();
    expect(parseFlexTime("garbage")).toBeNull();
  });
});

describe("fmtTime12", () => {
  it("formats 24h to 12h", () => {
    expect(fmtTime12("09:30")).toBe("9:30 AM");
    expect(fmtTime12("21:00")).toBe("9:00 PM");
    expect(fmtTime12("00:00")).toBe("12:00 AM");
    expect(fmtTime12("12:00")).toBe("12:00 PM");
  });
  it("handles null/empty", () => {
    expect(fmtTime12(null)).toBeNull();
    expect(fmtTime12(undefined)).toBeNull();
  });
});

describe("fmtTimeRange12", () => {
  it("renders Google-Calendar-style ranges", () => {
    expect(fmtTimeRange12("19:00", "19:30")).toBe("7-7:30PM");
    expect(fmtTimeRange12("09:15", "10:30")).toBe("9:15-10:30AM");
    expect(fmtTimeRange12("11:00", "13:00")).toBe("11AM-1PM");
    expect(fmtTimeRange12("09:00", "09:00")).toBe("9AM");
    expect(fmtTimeRange12("09:00", null)).toBe("9AM");
  });
});

describe("toISODate", () => {
  it("returns YYYY-MM-DD in local time", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toISODate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
