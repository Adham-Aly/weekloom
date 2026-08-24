"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { motion } from "framer-motion";
import { updateSettings } from "@/app/actions";
import {
  DEFAULT_SETTINGS,
  settingsDelta,
  type ResolvedSettings,
} from "@/lib/types/settings";
import { cn } from "@/lib/utils";
import { requestNotificationPermission } from "@/lib/hooks/use-notifications";
import { useFlushOnUnload } from "@/lib/hooks/use-flush-on-unload";
import { Personalization } from "@/components/personalization";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/ui/logo-mark";
import { PRODUCT_NAME } from "@/lib/brand";
import { ChevronLeft } from "@/components/icons";
import {
  Palette,
  Bell,
  LayoutGrid,
  Calendar,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

/**
 * Shown, not opened. The path is a constant the desktop shell also uses
 * (`electron/main.ts` passes `WEEKLOOM_DATA_DIR`), so rendering it needs no
 * privileged API — which is why this row is text rather than a button.
 */
const DATA_DIR_LABEL = "~/.weekloom";

type CatId = "appearance" | "notifications" | "gantt" | "calendar" | "general";

/** Left-nav structure: grouped sections of one continuous, scrolling page. */
const SETTINGS_GROUPS: {
  label: string;
  items: { id: CatId; label: string; icon: LucideIcon }[];
}[] = [
  {
    label: "Preferences",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Board",
    items: [
      { id: "gantt", label: "Gantt", icon: LayoutGrid },
      { id: "calendar", label: "Calendar", icon: Calendar },
    ],
  },
  {
    label: "General",
    items: [{ id: "general", label: "General", icon: SlidersHorizontal }],
  },
];

export function SettingsForm({ initial }: { initial: ResolvedSettings }) {
  const [s, setS] = useState<ResolvedSettings>(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  // Which section is currently in view — drives the nav highlight (scrollspy).
  const [activeCat, setActiveCat] = useState<CatId>("appearance");
  const mainRef = useRef<HTMLElement>(null);
  /**
   * The snapshot the server is known to hold. Seeded from the hydrated props
   * (so the first render never saves) and advanced only after a save lands —
   * every autosave diffs against THIS, never against the previous render, so a
   * failed save is retried by the next change rather than silently skipped.
   */
  const lastSavedRef = useRef<ResolvedSettings>(initial);

  // Apply theme live as it's toggled.
  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
    try {
      localStorage.setItem("gantt:theme", s.theme);
    } catch {}
  }, [s.theme]);

  /**
   * Auto-save debounce — sends ONLY the fields this tab changed.
   *
   * `updateSettings` merges its patch over the stored row, so sending the whole
   * object makes every save a full-document overwrite: a second Settings tab,
   * holding state from ITS page load, would rewrite every field and revert
   * anything changed elsewhere since. See `settingsDelta` for the measured
   * failure that motivates this. A no-op delta skips the round trip entirely.
   */
  useEffect(() => {
    const patch = settingsDelta(lastSavedRef.current, s);
    if (Object.keys(patch).length === 0) return;
    const id = setTimeout(() => {
      startTransition(async () => {
        await updateSettings(patch);
        // Advance the baseline only once the write has gone out, so a save
        // that throws leaves the fields dirty for the next change to retry.
        lastSavedRef.current = { ...lastSavedRef.current, ...patch };
        setSavedAt(Date.now());
      });
    }, 400);
    return () => clearTimeout(id);
  }, [s]);

  /**
   * ⚠️ **Same window, same loss.** The effect above cancels its own timer, so
   * changing a setting and leaving inside 400 ms — "Back" is one click away
   * from every control on this page — issued no write at all. MEASURED with
   * this flush removed and nothing else changed: set "Step row height" and
   * click Back immediately, and the row on disk never changes.
   * `e2e/ui-state.spec.ts`'s last test is that sequence.
   *
   * ⚠️ **This is a no-op once the timer's write has RESOLVED, not once the
   * timer has fired** — the effect above advances `lastSavedRef` after
   * `await updateSettings`, deliberately, so that a throw leaves the fields
   * dirty. A departure inside that gap therefore re-sends the same patch: one
   * departure, two writes, carrying identical values into a merge, so the
   * stored document is the same either way. `board.tsx`'s flush has no such
   * gap because its baseline advances at dispatch. The baseline is advanced
   * here before the call for the opposite reason to the effect above: there is
   * no next render left to retry from.
   */
  useFlushOnUnload(() => {
    const patch = settingsDelta(lastSavedRef.current, s);
    if (Object.keys(patch).length === 0) return;
    lastSavedRef.current = { ...lastSavedRef.current, ...patch };
    void updateSettings(patch).catch((e) =>
      console.error("[settings] flush failed", e),
    );
  });

  function update<K extends keyof ResolvedSettings>(
    k: K,
    v: ResolvedSettings[K],
  ) {
    setS((p) => ({ ...p, [k]: v }));
  }

  function restoreDefaults() {
    setS(DEFAULT_SETTINGS);
  }

  // Smooth-scroll the content pane to a section when its nav item is clicked.
  function scrollToCat(id: CatId) {
    document
      .getElementById(`set-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Scrollspy: highlight the nav item for whichever section sits at the top of
  // the scroll pane (and the last one when scrolled to the very bottom).
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const ids = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    const onScroll = () => {
      const rootTop = root.getBoundingClientRect().top;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(`set-${id}`);
        if (el && el.getBoundingClientRect().top - rootTop <= 100) current = id;
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4)
        current = ids[ids.length - 1];
      setActiveCat(current);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <Personalization accentColor={s.accentColor} />
      <header className="sticky top-0 z-50 flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg-elev px-4">
        <div className="flex items-center gap-2">
          <LogoMark />
          <h1 className="text-sm font-medium tracking-tight">{PRODUCT_NAME}</h1>
          <button
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1)
                router.back();
              else router.push("/app");
            }}
            title="Back"
            className="ml-1 flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-text-muted transition hover:bg-surface hover:text-text"
          >
            <ChevronLeft width={13} height={13} />
            Back
          </button>
          <span className="text-xs text-text-dim">/</span>
          <span className="text-xs text-text-muted">Settings</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-dim">
          {savedAt && <SavedPing key={savedAt} />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left nav — grouped sections; clicking scrolls to that section. */}
        <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-border px-3 py-6 sm:block">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.label} className="mb-6 last:mb-0">
              <div className="mb-1 px-3 text-[11.7px] font-semibold text-text">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeCat === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => scrollToCat(item.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[11.7px] transition",
                        active
                          ? "bg-surface font-medium text-text"
                          : "text-text-muted hover:bg-surface/60 hover:text-text",
                      )}
                    >
                      <Icon size={16} className="shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Content — one continuous scrolling page of all sections. */}
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-9 sm:px-10">
            {/* Compact horizontal section switcher on phones. */}
            <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-3 sm:hidden">
              {SETTINGS_GROUPS.flatMap((g) => g.items).map((item) => {
                const Icon = item.icon;
                const active = activeCat === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => scrollToCat(item.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.7px] transition",
                      active
                        ? "bg-surface font-medium text-text"
                        : "text-text-muted hover:bg-surface/60 hover:text-text",
                    )}
                  >
                    <Icon size={15} className="shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-14">
              <SectionPage id="appearance" title="Appearance">
                <RadioRow
                  label="Theme"
                  description="Choose a dark or light interface."
                  value={s.theme}
                  options={[
                    { value: "dark", label: "Dark" },
                    { value: "light", label: "Light" },
                  ]}
                  onChange={(v) => update("theme", v as "dark" | "light")}
                />
                <AccentColorRow
                  value={s.accentColor}
                  onChange={(v) => update("accentColor", v)}
                />
                <Toggle
                  label="Show gridlines"
                  description="Faint vertical + horizontal lines across the Gantt body."
                  value={s.gridlines}
                  onChange={(v) => update("gridlines", v)}
                />
                <Slider
                  label="Gridline opacity"
                  value={s.gridlinesOpacity}
                  min={0}
                  max={0.25}
                  step={0.005}
                  format={(v) => `${(v * 100).toFixed(1)}%`}
                  onChange={(v) => update("gridlinesOpacity", v)}
                  disabled={!s.gridlines}
                />
              </SectionPage>

              <SectionPage id="notifications" title="Notifications">
                <NotificationsSection s={s} update={(k, v) => update(k, v)} />
              </SectionPage>

              <SectionPage id="gantt" title="Gantt">
                <NumberField
                  label="Past days visible (default)"
                  description="How many days back the Gantt shows on load."
                  value={s.pastDays}
                  min={0}
                  max={30}
                  onChange={(v) => update("pastDays", v)}
                />
                <NumberField
                  label="Past days when “+ Past” expanded"
                  description="How far back the timeline reaches once expanded."
                  value={s.pastDaysExpanded}
                  min={1}
                  max={365}
                  onChange={(v) => update("pastDaysExpanded", v)}
                />
                <NumberField
                  label="Future days visible"
                  description="How far ahead the Gantt extends."
                  value={s.futureDays}
                  min={7}
                  max={365}
                  onChange={(v) => update("futureDays", v)}
                />
                <Toggle
                  label="Auto-scroll to today on load"
                  description="Jump to today's column whenever the board opens."
                  value={s.autoScrollToToday}
                  onChange={(v) => update("autoScrollToToday", v)}
                />
                <Toggle
                  label="Show recurring tasks on the Gantt"
                  description="Recurring series always render on the calendar; turn this on to also show their rows on the Gantt."
                  value={s.showRecurringOnGantt}
                  onChange={(v) => update("showRecurringOnGantt", v)}
                />
                <NumberField
                  label="Column width (px)"
                  description="Width of each day column. Drag the header edge to resize live."
                  value={s.colW}
                  min={36}
                  max={240}
                  onChange={(v) => update("colW", v)}
                />
                <NumberField
                  label="Step row height (px)"
                  description="Height of each step row. Drag the bottom edge of any row to resize live."
                  value={s.rowH}
                  min={18}
                  max={80}
                  onChange={(v) => update("rowH", v)}
                />
                <RadioRow
                  label="Default chip for new blocks"
                  description="Show a time of day or an effort estimate on each step."
                  value={s.defaultChipMode}
                  options={[
                    { value: "T", label: "Time" },
                    { value: "E", label: "Effort" },
                  ]}
                  onChange={(v) => update("defaultChipMode", v as "T" | "E")}
                />
              </SectionPage>

              <SectionPage id="calendar" title="Calendar">
                <NumberField
                  label="Start hour (0–23)"
                  description="First hour shown in the week & day calendar."
                  value={s.calendarStartHour}
                  min={0}
                  max={23}
                  onChange={(v) => update("calendarStartHour", v)}
                />
                <NumberField
                  label="End hour (1–24)"
                  description="Last hour shown in the week & day calendar."
                  value={s.calendarEndHour}
                  min={1}
                  max={24}
                  onChange={(v) => update("calendarEndHour", v)}
                />
                <NumberField
                  label="Hour row height (px)"
                  description="Taller = more room for event detail."
                  value={s.calendarHourHeight}
                  min={32}
                  max={200}
                  onChange={(v) => update("calendarHourHeight", v)}
                />
                <RadioRow
                  label="Drag snap (minutes)"
                  description="How finely events snap when dragged."
                  value={String(s.slotMin)}
                  options={[
                    { value: "5", label: "5 min" },
                    { value: "10", label: "10 min" },
                    { value: "15", label: "15 min" },
                    { value: "30", label: "30 min" },
                  ]}
                  onChange={(v) => update("slotMin", parseInt(v, 10))}
                />
              </SectionPage>

              <SectionPage id="general" title="General">
                <Row
                  label="Data"
                  description="Every board, task and preference lives in this folder on this computer. Nothing is uploaded anywhere."
                >
                  <code className="rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[10.3px] text-text-muted">
                    {DATA_DIR_LABEL}
                  </code>
                </Row>
                <Row
                  label="Restore defaults"
                  description="Reset every setting to its default value."
                >
                  <button
                    onClick={restoreDefaults}
                    className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text"
                  >
                    Restore all defaults
                  </button>
                </Row>
              </SectionPage>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/** One titled section of the scrolling settings page (a scrollspy target). */
function SectionPage({
  id,
  title,
  children,
}: {
  id: CatId;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`set-${id}`} className="scroll-mt-6">
      <h2 className="mb-4 text-[13.5px] font-semibold tracking-tight text-text">
        {title}
      </h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function NotificationsSection({
  s,
  update,
}: {
  s: ResolvedSettings;
  update: <K extends keyof ResolvedSettings>(
    k: K,
    v: ResolvedSettings[K],
  ) => void;
}) {
  /**
   * ⚠️ Resolved in an EFFECT, never in the initialiser.
   *
   * This component server-renders. `Notification` does not exist there, so an
   * initialiser that reads `Notification.permission` returns `"unsupported"` on
   * the server and something else on the client's first render — a hydration
   * mismatch (React error #418, thrown on every single load of this page), and
   * React then throws that subtree away and re-renders it.
   *
   * The user-visible half was worse than the error: the row was SERVED reading
   * "Your browser doesn't support notifications." and swapped afterwards. That
   * sentence is false in every runtime this app ships in — Electron and every
   * browser support notifications — so the one frame a person actually sees
   * first told them the opposite of the truth.
   *
   * `null` means "not determined yet" and is identical on both sides, which is
   * what makes the two renders agree. It reads as supported-but-not-granted,
   * which is the correct neutral copy and the common case.
   */
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported" | null
  >(null);
  useEffect(() => {
    setPermission(
      "Notification" in window ? Notification.permission : "unsupported",
    );
  }, []);
  const supported = permission !== "unsupported";
  const granted = permission === "granted";
  const denied = permission === "denied";

  async function onMasterToggle(next: boolean) {
    if (!supported) return;
    if (next && !granted) {
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result !== "granted") {
        // Don't flip the master on if the browser said no — the toggle
        // would lie about the actual state otherwise.
        update("notificationsEnabled", false);
        return;
      }
    }
    update("notificationsEnabled", next);
  }

  return (
    <>
      <Toggle
        label="Browser notifications"
        description={
          !supported
            ? "Your browser doesn't support notifications."
            : denied
              ? "Permission denied. Enable for this site in your browser's site settings, then try again."
              : "Master switch. Triggers below only fire when this is on."
        }
        value={s.notificationsEnabled && granted}
        onChange={onMasterToggle}
      />

      {/* Per-trigger toggles only meaningful when master is enabled. */}
      <Toggle
        label="Task starting"
        description="Pings at the scheduled start time. Most people find this redundant."
        value={s.notifyTaskStart}
        onChange={(v) => update("notifyTaskStart", v)}
        disabled={!s.notificationsEnabled || !granted}
      />
      <Toggle
        label="5 minutes before task ends"
        description="The flow-rescue ping — start wrapping up."
        value={s.notifyTaskEndingSoon}
        onChange={(v) => update("notifyTaskEndingSoon", v)}
        disabled={!s.notificationsEnabled || !granted}
      />
      <Toggle
        label="Task running over"
        description="5 minutes past the scheduled end, if it isn't marked done."
        value={s.notifyTaskOverdue}
        onChange={(v) => update("notifyTaskOverdue", v)}
        disabled={!s.notificationsEnabled || !granted}
      />
      <Toggle
        label="End-of-day rollup"
        description="Once-a-day reminder of unfinished today-tasks."
        value={s.notifyEndOfDay}
        onChange={(v) => update("notifyEndOfDay", v)}
        disabled={!s.notificationsEnabled || !granted}
      />
      <TimeField
        label="End-of-day time"
        value={s.endOfDayTime}
        onChange={(v) => update("endOfDayTime", v)}
        disabled={!s.notificationsEnabled || !granted || !s.notifyEndOfDay}
      />
      <Toggle
        label="Morning briefing"
        description="A summary of today's planned work."
        value={s.notifyMorningBriefing}
        onChange={(v) => update("notifyMorningBriefing", v)}
        disabled={!s.notificationsEnabled || !granted}
      />
      <TimeField
        label="Morning briefing time"
        value={s.morningBriefingTime}
        onChange={(v) => update("morningBriefingTime", v)}
        disabled={
          !s.notificationsEnabled || !granted || !s.notifyMorningBriefing
        }
      />
    </>
  );
}

function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label}>
      <input
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm tabular-nums focus:border-accent focus:outline-none disabled:opacity-50"
      />
    </Row>
  );
}

function SavedPing() {
  return (
    <motion.span
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="rounded bg-accent/15 px-2 py-0.5 text-[9px] font-medium text-accent"
    >
      Saved
    </motion.span>
  );
}

/**
 * One setting row: label + description on the left, control aligned to the
 * RIGHT end of the row (so every control lines up on the right edge). Two
 * columns on desktop with a full-width hairline divider (from the parent's
 * `divide-y`); stacks on phones.
 */
function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    // `data-setting-row` is part of the DOM query protocol, not decoration: the
    // label and its control are siblings with no `for`/`id` pair, so
    // `getByLabel` cannot reach the control and the e2e suite would otherwise
    // have to walk the DOM by layout class — which silently stops matching the
    // first time the grid is restyled.
    <div
      data-setting-row={label}
      className="grid gap-x-10 gap-y-3 py-6 sm:grid-cols-[14rem_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text">{label}</span>
        </div>
        {description && (
          <div className="mt-1 text-[11.2px] leading-relaxed text-text-muted">
            {description}
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-start justify-start sm:justify-end">
        {children}
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} description={description}>
      <button
        onClick={() => {
          if (!disabled) onChange(!value);
        }}
        disabled={disabled}
        aria-disabled={disabled}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          value ? "bg-accent" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            value && "translate-x-4",
          )}
        />
      </button>
    </Row>
  );
}

function Slider({
  label,
  description,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} description={description}>
      <div className="flex items-center gap-3">
        <div className="relative">
          <input
            type="range"
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-40 accent-[var(--accent)] disabled:opacity-50"
          />
        </div>
        <span className="w-12 text-right font-mono text-[9.9px] text-text-muted tabular-nums">
          {format ? format(value) : value}
        </span>
      </div>
    </Row>
  );
}

function NumberField({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} description={description}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm tabular-nums focus:border-accent focus:outline-none"
      />
    </Row>
  );
}

function RadioRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label} description={description}>
      <div className="inline-flex items-center rounded-md border border-border bg-surface p-0.5 text-[9.9px] font-medium">
        {options.map((o) => (
          <button
            key={o.value}
            // ⚠️ Which option is selected is otherwise carried by COLOUR
            // alone (`bg-accent text-white`), so a screen reader announces
            // three identical buttons and nothing says which one is on.
            // `aria-pressed` is also the only honest selector a test has for
            // "the stored value" — the alternative is querying a Tailwind
            // utility, which keeps matching until somebody restyles the
            // control and then stops silently.
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[5px] px-2.5 py-1 transition",
              value === o.value
                ? "bg-accent text-white"
                : "text-text-muted hover:text-text",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Row>
  );
}

const ACCENT_PRESETS = [
  { hex: "", label: "Default" },
  { hex: "#3b82f6", label: "Blue" },
  { hex: "#8b5cf6", label: "Violet" },
  { hex: "#ec4899", label: "Pink" },
  { hex: "#ef4444", label: "Red" },
  { hex: "#f59e0b", label: "Amber" },
  { hex: "#0f7a55", label: "Forest" },
  { hex: "#14b8a6", label: "Teal" },
];

function AccentColorRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [custom, setCustom] = useState(value);
  // Keep the custom input in sync if the parent resets (Restore defaults).
  useEffect(() => setCustom(value), [value]);

  function commit(next: string) {
    const trimmed = next.trim();
    if (trimmed === "" || /^#[0-9a-fA-F]{6}$/.test(trimmed)) onChange(trimmed);
  }

  return (
    <Row
      label="Accent color"
      description="Used for buttons, highlights, and the today line. Empty = use the theme default."
    >
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex || "default"}
              onClick={() => {
                onChange(p.hex);
                setCustom(p.hex);
              }}
              title={p.label}
              className={cn(
                "h-6 w-6 rounded-full border transition",
                value === p.hex
                  ? "border-text scale-110 shadow-sm"
                  : "border-border hover:scale-105",
              )}
              style={{
                background:
                  p.hex ||
                  "linear-gradient(135deg, var(--border-strong) 0%, var(--bg-elev) 100%)",
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            value={value || "#3b82f6"}
            onChange={(e) => onChange(e.target.value)}
            className="h-6 w-6 cursor-pointer rounded border border-border bg-transparent"
            title="Custom color"
          />
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => commit(custom)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="#3b82f6"
            spellCheck={false}
            className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono text-[9.9px] uppercase focus:border-accent focus:outline-none"
          />
        </div>
      </div>
    </Row>
  );
}
