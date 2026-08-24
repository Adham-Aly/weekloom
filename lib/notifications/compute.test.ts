import { describe, expect, it } from "vitest";
import { computeUpcoming } from "./compute";
import { DEFAULT_SETTINGS, type ResolvedSettings } from "@/lib/types/settings";
import type { Item, Step } from "@/lib/types/database";

const TODAY = new Date(2026, 4, 23, 10, 0, 0); // 2026-05-23 10:00

function settings(over: Partial<ResolvedSettings> = {}): ResolvedSettings {
  return {
    ...DEFAULT_SETTINGS,
    notificationsEnabled: true,
    notifyTaskStart: true,
    notifyTaskEndingSoon: true,
    notifyTaskOverdue: true,
    notifyEndOfDay: true,
    notifyMorningBriefing: true,
    endOfDayTime: "21:00",
    morningBriefingTime: "08:00",
    ...over,
  };
}

function item(over: Partial<Item> = {}): Item {
  return {
    id: "i1",
    board_id: "bd",
    block_id: "b",
    title: "Demo",
    color: null,
    deadline_id: null,
    deadline_offset: 3,
    duration_days: 3,
    start_date: "2026-05-23",
    sort_order: 0,
    prev_block_id: null,
    recurrence: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function step(over: Partial<Step> & { id: string }): Step {
  return {
    board_id: "bd",
    item_id: "i1",
    day_offset: 0,
    label: "",
    notes: null,
    status: "todo",
    time_of_day: null,
    duration_min: null,
    detached: false,
    origin_day_offset: null,
    completed_at: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("computeUpcoming", () => {
  it("returns nothing when notifications disabled", () => {
    expect(
      computeUpcoming(
        TODAY,
        [item()],
        [step({ id: "s1", time_of_day: "14:00" })],
        settings({ notificationsEnabled: false }),
      ),
    ).toEqual([]);
  });

  it("generates start/ending-soon/overdue for a timed today-step", () => {
    const result = computeUpcoming(
      TODAY,
      [item()],
      [
        step({
          id: "s1",
          time_of_day: "14:00",
          duration_min: 30,
          label: "Deep work",
        }),
      ],
      settings(),
    );
    const kinds = result.map((n) => n.kind);
    expect(kinds).toContain("task-start");
    expect(kinds).toContain("task-ending-soon");
    expect(kinds).toContain("task-overdue");

    const start = result.find((n) => n.kind === "task-start")!;
    expect(new Date(start.fireAt).getHours()).toBe(14);
    expect(start.title).toContain("Deep work");

    const ending = result.find((n) => n.kind === "task-ending-soon")!;
    // 14:00 + 30min - 5min = 14:25
    expect(new Date(ending.fireAt).getHours()).toBe(14);
    expect(new Date(ending.fireAt).getMinutes()).toBe(25);

    const overdue = result.find((n) => n.kind === "task-overdue")!;
    // 14:30 + 5min grace = 14:35
    expect(new Date(overdue.fireAt).getMinutes()).toBe(35);
  });

  it("skips TBD (timeless) steps", () => {
    const result = computeUpcoming(
      TODAY,
      [item()],
      [step({ id: "s1", time_of_day: null })],
      settings(),
    );
    expect(result.filter((n) => n.kind.startsWith("task-"))).toEqual([]);
  });

  it("skips done steps", () => {
    const result = computeUpcoming(
      TODAY,
      [item()],
      [step({ id: "s1", time_of_day: "10:00", status: "done" })],
      settings(),
    );
    expect(result.filter((n) => n.kind.startsWith("task-"))).toEqual([]);
  });

  it("skips steps not scheduled for today", () => {
    const result = computeUpcoming(
      TODAY,
      [item({ start_date: "2026-06-01" })],
      [step({ id: "s1", time_of_day: "10:00" })],
      settings(),
    );
    expect(result.filter((n) => n.kind.startsWith("task-"))).toEqual([]);
  });

  it("morning briefing only when there's open work today", () => {
    const r1 = computeUpcoming(
      TODAY,
      [item()],
      [step({ id: "s1" })], // TBD today, open
      settings(),
    );
    expect(r1.some((n) => n.kind === "morning-briefing")).toBe(true);

    const r2 = computeUpcoming(
      TODAY,
      [item()],
      [step({ id: "s1", status: "done" })],
      settings(),
    );
    expect(r2.some((n) => n.kind === "morning-briefing")).toBe(false);
  });

  it("end-of-day fires only when unfinished work today", () => {
    const r = computeUpcoming(
      TODAY,
      [item()],
      [step({ id: "s1", status: "done" })],
      settings(),
    );
    expect(r.some((n) => n.kind === "end-of-day")).toBe(false);
  });

  it("respects per-trigger toggles independently", () => {
    const r = computeUpcoming(
      TODAY,
      [item()],
      [step({ id: "s1", time_of_day: "14:00", duration_min: 30 })],
      settings({
        notifyTaskStart: false,
        notifyTaskOverdue: false,
        notifyMorningBriefing: false,
        notifyEndOfDay: false,
      }),
    );
    expect(r.map((n) => n.kind)).toEqual(["task-ending-soon"]);
  });

  it("sorts notifications by fireAt ascending", () => {
    const r = computeUpcoming(
      TODAY,
      [item()],
      [
        step({ id: "s1", time_of_day: "08:00", duration_min: 30 }),
        step({ id: "s2", time_of_day: "16:00", duration_min: 30 }),
      ],
      settings(),
    );
    for (let i = 1; i < r.length; i++) {
      expect(r[i].fireAt).toBeGreaterThanOrEqual(r[i - 1].fireAt);
    }
  });

  it("ignores invalid HH:MM gracefully", () => {
    const r = computeUpcoming(
      TODAY,
      [item()],
      [step({ id: "s1" })],
      settings({ endOfDayTime: "bogus", morningBriefingTime: "25:99" }),
    );
    expect(r.some((n) => n.kind === "end-of-day")).toBe(false);
    expect(r.some((n) => n.kind === "morning-briefing")).toBe(false);
  });
});
