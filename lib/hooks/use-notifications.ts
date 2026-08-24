"use client";

import { useEffect, useRef } from "react";
import type { Item, Step } from "@/lib/types/database";
import type { ResolvedSettings } from "@/lib/types/settings";
import {
  computeUpcoming,
  type ScheduledNotification,
} from "@/lib/notifications/compute";
import { toISODate } from "@/lib/utils";

/**
 * localStorage key holding `${date}` → `string[]` of notification ids fired
 * that day. Cleared on first use of a new day to avoid unbounded growth.
 */
const FIRED_KEY = "gantt:notifs:fired";

function readFiredToday(todayISO: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { date?: string; ids?: string[] };
    if (parsed.date !== todayISO) return new Set(); // rolled over
    return new Set(parsed.ids ?? []);
  } catch {
    return new Set();
  }
}

function writeFiredToday(todayISO: string, ids: Set<string>) {
  try {
    localStorage.setItem(
      FIRED_KEY,
      JSON.stringify({ date: todayISO, ids: Array.from(ids) }),
    );
  } catch {}
}

/**
 * Browser-Notification-API scheduler. Runs while the page is open; fires
 * computed notifications at their wall-clock time. No service worker, no
 * push server — Sprint N2 work, deliberately not in scope here.
 *
 * Behaviour:
 *   - Re-computes the schedule on every state/setting change.
 *   - Finds the next not-yet-fired notification with `fireAt > now`,
 *     sets a single timeout to it.
 *   - When it fires, marks the id as fired (per-day localStorage), then
 *     re-runs the loop for the next one.
 *   - If permission isn't granted (or the master toggle is off, or notifs
 *     aren't supported), the hook is a no-op.
 *   - Notifications fired in the past (e.g. tab was closed) are skipped,
 *     not retroactively dispatched.
 */
export function useNotifications(
  items: Item[],
  steps: Step[],
  settings: ResolvedSettings,
) {
  // Stash latest data in refs so the timeout callback always reads fresh
  // state without us tearing down/recreating the timer on every keystroke.
  const dataRef = useRef({ items, steps, settings });
  dataRef.current = { items, steps, settings };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const DEBUG = (() => {
      try {
        return localStorage.getItem("gantt:debug:notifs") === "1";
      } catch {
        return false;
      }
    })();
    const log = (...args: unknown[]) => {
      if (DEBUG) console.log("[notif]", ...args);
    };

    if (!("Notification" in window)) {
      log("aborted: browser does not support Notification API");
      return;
    }
    if (!settings.notificationsEnabled) {
      log("aborted: master toggle off");
      return;
    }
    if (Notification.permission !== "granted") {
      log(
        "aborted: permission =",
        Notification.permission,
        "(grant via browser site settings)",
      );
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function schedule() {
      if (cancelled) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const now = new Date();
      const todayISO = toISODate(now);
      const fired = readFiredToday(todayISO);
      const upcoming = computeUpcoming(
        now,
        dataRef.current.items,
        dataRef.current.steps,
        dataRef.current.settings,
      );
      log("schedule pass at", now.toLocaleTimeString(), {
        nowMs: now.getTime(),
        totalUpcoming: upcoming.length,
        alreadyFiredCount: fired.size,
      });
      if (DEBUG) {
        for (const n of upcoming) {
          const inPast = n.fireAt <= now.getTime() - 60_000;
          const alreadyFired = fired.has(n.id);
          console.log(
            "[notif] candidate",
            n.kind,
            "→",
            new Date(n.fireAt).toLocaleTimeString(),
            alreadyFired
              ? "SKIP: already fired"
              : inPast
                ? `SKIP: ${Math.round((now.getTime() - n.fireAt) / 1000)}s in past`
                : "ELIGIBLE",
            { id: n.id, title: n.title },
          );
        }
      }
      // Drop already-fired ids AND any that are >1min in the past (we don't
      // retroactively spam if the tab was closed when they were due).
      const nextEligible = upcoming.find(
        (n) => !fired.has(n.id) && n.fireAt > now.getTime() - 60_000,
      );
      if (!nextEligible) {
        log("nothing eligible — sleeping");
        return;
      }
      const delay = Math.max(0, nextEligible.fireAt - now.getTime());
      log(
        "next:",
        nextEligible.kind,
        "in",
        Math.round(delay / 1000),
        "s →",
        nextEligible.title,
      );
      timer = setTimeout(() => fire(nextEligible), delay);
    }

    function fire(n: ScheduledNotification) {
      if (cancelled) return;
      if (Notification.permission !== "granted") {
        log("dispatch aborted: permission lost");
        return;
      }
      log("FIRING", n.kind, n.title);
      try {
        const notif = new Notification(n.title, {
          // Empty body is intentional — many of our notifications carry
          // all useful info in the title; the OS will collapse the row.
          body: n.body || undefined,
          icon: "/weekloom-logo.svg",
          // No `badge` — on macOS desktop it just renders as a second
          // small image cluttering the right side. Mobile uses it for
          // the status bar, but we're not targeting mobile push (N2).
          tag: n.id,
          data: { stepId: n.stepId, itemId: n.itemId, kind: n.kind },
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (e) {
        log("dispatch threw", e);
      }
      const todayISO = toISODate(new Date());
      const fired = readFiredToday(todayISO);
      fired.add(n.id);
      writeFiredToday(todayISO, fired);
      schedule();
    }

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Re-schedule whenever the inputs that affect timing change. The
    // contents of items/steps are reflected via dataRef, but we still want
    // the effect to re-run on those array references so a newly-added
    // step's notifications get scheduled.
  }, [
    items,
    steps,
    settings.notificationsEnabled,
    settings.notifyTaskStart,
    settings.notifyTaskEndingSoon,
    settings.notifyTaskOverdue,
    settings.notifyEndOfDay,
    settings.notifyMorningBriefing,
    settings.endOfDayTime,
    settings.morningBriefingTime,
  ]);
}

/**
 * Imperative helper for the settings toggle: requests permission and
 * resolves to the final state. Returns false if the browser doesn't
 * support notifications at all.
 */
export async function requestNotificationPermission(): Promise<
  "granted" | "denied" | "default" | "unsupported"
> {
  if (typeof window === "undefined" || !("Notification" in window))
    return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}
