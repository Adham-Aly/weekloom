/**
 * User preferences. `UserSettings` is the wire/storage shape (every field
 * optional, since older clients may have written a subset). `ResolvedSettings`
 * is the runtime shape after `mergeSettings` fills in defaults — every field
 * guaranteed present.
 */
export type UserSettings = {
  theme?: "dark" | "light";
  gridlines?: boolean;
  gridlinesOpacity?: number; // 0..1
  pastDays?: number;
  pastDaysExpanded?: number;
  futureDays?: number;
  /** The chip a lane shows when it has no entry in `chipModeByBlock` — which
   *  is what the Settings control means by "Default chip for new blocks". */
  defaultChipMode?: "T" | "E";
  /** Per-block chip mode on the Gantt, keyed by block id — what Shift+T and
   *  Shift+E record. Durable presentation state: it belongs to the plan, not
   *  to the window that happens to be showing it, so it lives in this
   *  document rather than in `localStorage` — which is keyed by origin, and
   *  the origin contains a port.
   *
   *  ⚠️ **A lane is absent from this map until somebody chooses for it, and
   *  that absence is meaningful** — it is what lets `defaultChipMode` still
   *  govern a lane created after the choice was made. `board.tsx` reads
   *  `chipModeByBlock[block.id] ?? settings.defaultChipMode` at its
   *  `BlockSection` call site, and `step-row.tsx` draws the time chip on "T"
   *  and the effort-minutes input on "E". Never seed this map with an entry
   *  per lane on load: that would freeze every existing lane against a later
   *  change of the default, silently. */
  chipModeByBlock?: Record<string, "T" | "E">;
  calendarStartHour?: number;
  calendarEndHour?: number;
  calendarHourHeight?: number;
  slotMin?: number;
  autoScrollToToday?: boolean;
  /** Show recurring-series rows on the Gantt. Off by default — occurrences
   *  live on the calendar; the Gantt stays focused on one-off planning. */
  showRecurringOnGantt?: boolean;
  /** Gantt column width in px. In the settings document rather than the
   *  window, so a relaunch opens on the same grid. */
  colW?: number;
  /** Gantt step-row height in px. Stored the same way as `colW`. */
  rowH?: number;
  /** Sticky-left sidebar width in px. */
  sidebarW?: number;
  /** Whether the sidebar is collapsed to a thin strip. */
  sidebarCollapsed?: boolean;
  /** Ids of items whose step rows are collapsed. Stored, not window-local:
   *  a person who collapsed forty finished tasks means it, and re-expanding
   *  them on every launch is not a fresh start, it is lost work. */
  collapsedItemIds?: string[];
  /** Items whose end-date countdown shows in the Deadlines strip. */
  pinnedItemIds?: string[];
  /** The board the user last had open. Bare `/app` redirects here, falling
   *  back to the user's first board by `sort_order` when unset/stale. */
  activeBoardId?: string | null;
  /** The lane the last task was created in; the New-task modal pre-selects
   *  it. Null until the first task is made, and dropped at read time if the
   *  lane has since been deleted. */
  lastBlockId?: string | null;
  // ── Browser notifications ──
  /** Master kill-switch. When false, nothing fires regardless of per-trigger flags. */
  notificationsEnabled?: boolean;
  /** "Task is starting" at its scheduled time. Off by default — most users find it redundant. */
  notifyTaskStart?: boolean;
  /** "Task ending in 5 min" — the flow-rescue notification. */
  notifyTaskEndingSoon?: boolean;
  /** "Task ran past its scheduled end and still isn't done." */
  notifyTaskOverdue?: boolean;
  /** Once-a-day rollup of unfinished today-tasks. */
  notifyEndOfDay?: boolean;
  /** Once-a-day morning briefing of what's planned today. Off by default. */
  notifyMorningBriefing?: boolean;
  /** "HH:MM" — when the end-of-day rollup fires. */
  endOfDayTime?: string;
  /** "HH:MM" — when the morning briefing fires. */
  morningBriefingTime?: string;
  // ── Personalisation ──
  /** Custom accent colour as #RRGGBB. Overrides the theme's default accent. */
  accentColor?: string;
  // ── Confirmation dialogs ──
  /** ISO date (YYYY-MM-DD) the user last ticked "Don't show again for today"
   *  on the "moving this task will shift its deadline" warning. The warning is
   *  suppressed only while this equals today's date. */
  suppressShiftDeadlineWarningDate?: string;
  /** User checked "Don't ask again" on the shrink-task confirmation.
   *  When true, shrinks proceed silently — including destructive ones
   *  that drop labeled steps. */
  suppressShrinkWarning?: boolean;
};

export type ResolvedSettings = Required<UserSettings>;

export const DEFAULT_SETTINGS: ResolvedSettings = {
  /** ⚠️ Must stay in step with the `data-theme` on <html> in `app/layout.tsx`.
   *  `globals.css` is dark-first, so the markup has to name the light default
   *  explicitly or the first paint is dark and corrects itself at hydration —
   *  a flash on every launch. Changing this without changing that reintroduces
   *  exactly that. */
  theme: "light",
  /** ⚠️ Off, so a first launch opens on a clean board. This is a DEFAULT, not a
   *  migration: `updateSettings` merges deltas, so the row holds only keys a
   *  person actually changed, and anyone who never touched the toggle has no
   *  `gridlines` key to resolve from. Flipping this therefore also turns
   *  gridlines off for existing users who left it alone — which is the intent,
   *  but it is why the change is not invisible to them. */
  gridlines: false,
  gridlinesOpacity: 0.04,
  pastDays: 2,
  pastDaysExpanded: 30,
  futureDays: 90,
  defaultChipMode: "T",
  chipModeByBlock: {},
  calendarStartHour: 6,
  calendarEndHour: 24,
  calendarHourHeight: 80,
  slotMin: 15,
  autoScrollToToday: true,
  showRecurringOnGantt: false,
  colW: 89,
  rowH: 36,
  sidebarW: 360,
  sidebarCollapsed: false,
  collapsedItemIds: [],
  pinnedItemIds: [],
  activeBoardId: null,
  lastBlockId: null,
  notificationsEnabled: false,
  notifyTaskStart: false,
  notifyTaskEndingSoon: true,
  notifyTaskOverdue: true,
  notifyEndOfDay: true,
  notifyMorningBriefing: false,
  endOfDayTime: "21:00",
  morningBriefingTime: "08:00",
  // Empty strings → fall back to the theme/system defaults at runtime.
  accentColor: "",
  suppressShiftDeadlineWarningDate: "",
  suppressShrinkWarning: false,
};

/**
 * Merge a raw settings record (arbitrary JSON from the DB) with defaults.
 * Unknown keys are ignored; known keys keep their stored value if present.
 */
export function mergeSettings(
  raw: Record<string, unknown> | null | undefined,
): ResolvedSettings {
  const out: ResolvedSettings = { ...DEFAULT_SETTINGS };
  if (!raw) return out;
  for (const key of Object.keys(
    DEFAULT_SETTINGS,
  ) as (keyof ResolvedSettings)[]) {
    const v = raw[key];
    if (v !== undefined && v !== null) {
      // We trust the type because only this app writes to user_settings,
      // and updateSettings is the only writer (with bounded input).
      (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

/**
 * The keys that actually changed between two settings snapshots.
 *
 * ═══ WHY A DELTA AND NOT THE WHOLE OBJECT ══════════════════════════════════
 *
 * `updateSettings` MERGES its patch over the stored row, so a patch carrying
 * every key is a last-writer-wins overwrite of the entire document. The
 * Settings form used to send exactly that — its whole `ResolvedSettings` — and
 * every other caller in the app sends a minimal patch (`{colW, rowH, …}`).
 * That asymmetry is what made a second Settings surface, or the same one after
 * a long idle, destructive: its state was hydrated when it opened, so the
 * moment anything in it changed it rewrote all thirty-odd fields from that
 * stale snapshot, silently reverting whatever had been changed elsewhere in
 * the meantime.
 *
 * The symptom is a setting that "doesn't do anything": you set the drag snap
 * to 30 minutes in one place, a stale surface writes `15` back, and the
 * calendar — reading the stored row, correctly — keeps snapping to 15.
 * MEASURED: a freshly written value was reverted by a stale full-object save
 * within seconds, with no user action beyond the change that save was itself
 * making.
 *
 * Sending only the changed keys makes concurrent writers additive instead of
 * destructive: each can own the fields it touched. It does not make the form a
 * CRDT — two writers editing THE SAME field still race, and the last one wins,
 * which is the correct and expected behaviour.
 *
 * Comparison is by `JSON.stringify` because the values are JSON scalars plus
 * `pinnedItemIds` (a string array); reference equality would report unchanged
 * arrays as changed on every render and undo the whole point.
 */
export function settingsDelta(
  before: ResolvedSettings,
  after: ResolvedSettings,
): Partial<ResolvedSettings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(
    DEFAULT_SETTINGS,
  ) as (keyof ResolvedSettings)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      out[key] = after[key];
    }
  }
  return out as Partial<ResolvedSettings>;
}
