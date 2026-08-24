/**
 * Pure notification scheduler. Given the current state, returns every
 * notification that's eligible to fire today, with its target wall-clock
 * fire time. The hook decides which to dispatch based on `now`.
 *
 * Why pure: keeps the firing logic deterministic and unit-testable. The
 * effectful hook just polls this on every state change, picks the next
 * future notification, setTimeout-s to it, fires, marks as fired.
 */
import type { Item, Step } from "@/lib/types/database";
import type { ResolvedSettings } from "@/lib/types/settings";
import { isoAtOffset } from "@/lib/gantt/layout";
import { toISODate } from "@/lib/utils";

export type NotificationKind =
  | "task-start"
  | "task-ending-soon"
  | "task-overdue"
  | "end-of-day"
  | "morning-briefing";

export type ScheduledNotification = {
  /** Stable key for dedup; same id never fires twice. Day-scoped. */
  id: string;
  kind: NotificationKind;
  /** Epoch ms when this should fire (local timezone). */
  fireAt: number;
  title: string;
  body: string;
  /** Step id (when applicable) so click actions can route to it. */
  stepId?: string;
  itemId?: string;
};

const TASK_ENDING_LEAD_MIN = 5;
const TASK_OVERDUE_GRACE_MIN = 5;
const DEFAULT_STEP_DURATION_MIN = 30;

function parseHM(hm: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59)
    return null;
  return { h, m: min };
}

/** Today's date with the given HH:MM applied, as epoch ms. */
function todayAt(now: Date, hm: string): number | null {
  const parsed = parseHM(hm);
  if (!parsed) return null;
  const d = new Date(now);
  d.setHours(parsed.h, parsed.m, 0, 0);
  return d.getTime();
}

/** Today's date with HH:MM (24h) applied + minute offset, as epoch ms. */
function todayAtWithOffset(now: Date, hm: string, offsetMin: number): number {
  const parsed = parseHM(hm);
  if (!parsed) return NaN;
  const d = new Date(now);
  d.setHours(parsed.h, parsed.m, 0, 0);
  return d.getTime() + offsetMin * 60_000;
}

export function computeUpcoming(
  now: Date,
  items: Item[],
  steps: Step[],
  settings: ResolvedSettings,
): ScheduledNotification[] {
  if (!settings.notificationsEnabled) return [];

  const out: ScheduledNotification[] = [];
  const todayISO = toISODate(now);
  const itemsById = new Map(items.map((i) => [i.id, i]));

  // ── Per-step notifications (only for today's timed steps) ──
  const todaySteps: Array<{ step: Step; item: Item }> = [];
  for (const s of steps) {
    if (s.status === "done") continue;
    if (!s.time_of_day) continue; // TBD steps don't generate timed pings
    const item = itemsById.get(s.item_id);
    if (!item) continue;
    if (isoAtOffset(item.start_date, s.day_offset) !== todayISO) continue;
    todaySteps.push({ step: s, item });
  }

  for (const { step, item } of todaySteps) {
    const startMs = todayAtWithOffset(now, step.time_of_day!, 0);
    if (isNaN(startMs)) continue;
    const dur = step.duration_min ?? DEFAULT_STEP_DURATION_MIN;
    const endMs = startMs + dur * 60_000;
    const label = step.label.trim() || item.title;

    // Dedup id includes the step's time_of_day + duration so that editing
    // either of those generates a fresh id — otherwise re-scheduling the
    // same step is silently swallowed by an "already fired" entry from
    // earlier today.
    const sig = `${step.time_of_day}@${step.duration_min ?? "_"}`;

    // Body is only meaningful when the title doesn't already convey
    // everything. If the step has no label, `label` falls back to the
    // item title — printing it again as the body would just be noise.
    const showItemContext =
      step.label.trim() !== "" && step.label.trim() !== item.title;

    if (settings.notifyTaskStart) {
      out.push({
        id: `${todayISO}:task-start:${step.id}:${sig}`,
        kind: "task-start",
        fireAt: startMs,
        title: `Starting: ${label}`,
        body: showItemContext ? item.title : "",
        stepId: step.id,
        itemId: item.id,
      });
    }

    if (settings.notifyTaskEndingSoon) {
      out.push({
        id: `${todayISO}:task-ending-soon:${step.id}:${sig}`,
        kind: "task-ending-soon",
        fireAt: endMs - TASK_ENDING_LEAD_MIN * 60_000,
        title: `${TASK_ENDING_LEAD_MIN} min left — ${label}`,
        body: showItemContext ? item.title : "",
        stepId: step.id,
        itemId: item.id,
      });
    }

    if (settings.notifyTaskOverdue) {
      out.push({
        id: `${todayISO}:task-overdue:${step.id}:${sig}`,
        kind: "task-overdue",
        fireAt: endMs + TASK_OVERDUE_GRACE_MIN * 60_000,
        title: `Still on ${label}?`,
        body: `Scheduled to end ${TASK_OVERDUE_GRACE_MIN}m ago.`,
        stepId: step.id,
        itemId: item.id,
      });
    }
  }

  // ── Once-a-day morning briefing ──
  if (settings.notifyMorningBriefing) {
    const fireAt = todayAt(now, settings.morningBriefingTime);
    if (fireAt !== null) {
      // Count today's open steps for the body.
      let openToday = 0;
      for (const s of steps) {
        if (s.status === "done") continue;
        const item = itemsById.get(s.item_id);
        if (!item) continue;
        if (isoAtOffset(item.start_date, s.day_offset) === todayISO)
          openToday++;
      }
      if (openToday > 0) {
        out.push({
          id: `${todayISO}:morning-briefing`,
          kind: "morning-briefing",
          fireAt,
          title: "Good morning ☀️",
          body: `${openToday} thing${openToday === 1 ? "" : "s"} planned for today.`,
        });
      }
    }
  }

  // ── End-of-day rollup ──
  if (settings.notifyEndOfDay) {
    const fireAt = todayAt(now, settings.endOfDayTime);
    if (fireAt !== null) {
      let openToday = 0;
      for (const s of steps) {
        if (s.status === "done") continue;
        const item = itemsById.get(s.item_id);
        if (!item) continue;
        if (isoAtOffset(item.start_date, s.day_offset) === todayISO)
          openToday++;
      }
      if (openToday > 0) {
        out.push({
          id: `${todayISO}:end-of-day`,
          kind: "end-of-day",
          fireAt,
          title: `${openToday} unfinished today 🌙`,
          body: `Roll them to tomorrow?`,
        });
      }
    }
  }

  out.sort((a, b) => a.fireAt - b.fireAt);
  return out;
}
