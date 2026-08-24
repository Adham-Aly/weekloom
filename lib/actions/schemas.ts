/**
 * Zod allowlists for every server action input. The row types in
 * `database.ts` are deliberately wide (so client code can read them); these
 * narrow them to exactly the fields a caller is allowed to send. Server-set
 * fields — `id` where the server mints it, `created_at`, `updated_at`,
 * `is_system`, and any `board_id` a parent row derives — are stripped here and
 * must never be accepted from the caller.
 *
 * ⚠️ **These allowlists are the trust boundary and they survive being local.**
 * The renderer is a separate process running a DOM, and these bound
 * `day_offset` to `[0, 3650]`, `time_of_day` to a real wall clock and
 * `duration_days` to `[1, 730]`. Never widen one on the reasoning that there
 * is only one user: a bad value reaches SQLite, and the tables are `STRICT`
 * about types but say nothing about ranges.
 */
import { z } from "zod";

const uuid = z.string().uuid();

/**
 * An id arriving from the caller. Lives here rather than in a guards module of
 * its own: this is the input-validation surface, and an id is an input.
 */
export const uuidSchema = uuid;
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be #RRGGBB");
// Per-row safety caps: a bounded string cannot become an unbounded row.
const safeText = (max: number) => z.string().max(max);

// ─── Blocks ─────────────────────────────────────────────────────────
// Lucide-react icon name (e.g. "Briefcase"). Bounded length matches the
// DB CHECK on blocks.icon; alphanumeric-only matches lucide's naming.
const iconName = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9]+$/);

export const blockCreateSchema = z.object({
  // Optional caller-supplied id so undo-of-delete can restore the row with its
  // original UUID (preserving any in-memory references), and so a repeated
  // create upserts instead of duplicating.
  id: uuid.optional(),
  // Required board scope; the server action supplies it from the validated
  // active board. Every data row is denormalized with its board_id.
  board_id: uuid,
  name: safeText(200).min(1),
  color: hexColor.optional(),
  icon: iconName.nullable().optional(),
  sort_order: z.number().int().optional(),
  collapsed: z.boolean().optional(),
});
export const blockUpdateSchema = z.object({
  name: safeText(200).min(1).optional(),
  color: hexColor.optional(),
  icon: iconName.nullable().optional(),
  sort_order: z.number().int().optional(),
  collapsed: z.boolean().optional(),
  // Archiving hides a lane without deleting its tasks; the board renders
  // archived block headers so the state is reversible from the UI.
  archived: z.boolean().optional(),
});

// ─── Boards ─────────────────────────────────────────────────────────
// The top-level entity above blocks. Mirrors the block create/update shape;
// `id` and the timestamps are server-set. New boards default to the name
// "Untitled Board" on the client, but a name is still required here.
export const boardCreateSchema = z.object({
  name: safeText(200).min(1),
  color: hexColor.optional(),
  icon: iconName.nullable().optional(),
  sort_order: z.number().int().optional(),
});
export const boardUpdateSchema = z.object({
  name: safeText(200).min(1).optional(),
  color: hexColor.optional(),
  icon: iconName.nullable().optional(),
  sort_order: z.number().int().optional(),
  // Archiving a board moves it to the home screen's Trash tab, from which it
  // can be restored or deleted forever.
  archived: z.boolean().optional(),
});

// ─── Items ──────────────────────────────────────────────────────────
// Recurrence rule for a series item. Occurrences are the item's steps,
// materialized over a rolling horizon; this validates the rule's shape.
// A real wall-clock time. The old `\d{2}:\d{2}` shape admitted "24:15"/"99:00".
// Nothing downstream re-checks it — `steps.time_of_day` is floating-local TEXT,
// so an impossible time is stored verbatim and renders as garbage on the
// calendar forever. (A drag below the calendar grid's midnight bottom edge
// produced exactly that value.) This regex is the only place it is caught.
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);

export const recurrenceSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  time: timeOfDay,
  durationMin: z.number().int().min(0).max(1440).nullable(),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const baseItemFields = {
  title: safeText(500),
  // Nullable: a blockless item is a calendar-only task (renders in the
  // Calendar but not the Gantt). A real block id "graduates" it to the Gantt.
  block_id: uuid.nullable(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration_days: z.number().int().min(1).max(730).optional(),
  deadline_offset: z.number().int().min(0).max(3650).optional(),
  deadline_id: uuid.nullable().optional(),
  color: hexColor.nullable().optional(),
  sort_order: z.number().int().optional(),
};
export const itemCreateSchema = z.object({
  ...baseItemFields,
  // Required board scope; the server action supplies it from the validated
  // active board. Items never cross boards, so this rides on create only.
  board_id: uuid,
  // Caller-supplied UUIDs are allowed for optimistic-UI keying: the row the
  // client rendered and the row that lands share a React key, so there is no
  // remount when the server's answer arrives.
  id: uuid.optional(),
  stepIds: z.array(uuid).max(730).optional(),
  // Optional time-of-day + duration for the FIRST step — lets the calendar
  // quick-create make a timed event atomically (no window where it would
  // briefly render as an untimed/TBD card before a follow-up update).
  stepTime: timeOfDay.nullable().optional(),
  stepDurationMin: z.number().int().min(0).max(1440).nullable().optional(),
  // Optional label for the FIRST step. Calendar quick-create passes the typed
  // name here so the event's card text lives on the step, not just the item.
  stepLabel: safeText(1000).optional(),
  // Recurring series: the rule plus explicit sparse step offsets (one per
  // occurrence). When stepOffsets is present, steps are created at exactly
  // those offsets (each carrying stepTime/stepDurationMin) instead of one
  // per day of the duration.
  recurrence: recurrenceSchema.nullable().optional(),
  stepOffsets: z.array(z.number().int().min(0).max(729)).max(730).optional(),
});
export const itemUpdateSchema = z.object({
  title: safeText(500).optional(),
  // Nullable so an item can be demoted to calendar-only (block_id → null) or
  // promoted into a block from the calendar.
  block_id: uuid.nullable().optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  duration_days: z.number().int().min(1).max(730).optional(),
  deadline_offset: z.number().int().min(0).max(3650).optional(),
  deadline_id: uuid.nullable().optional(),
  color: hexColor.nullable().optional(),
  sort_order: z.number().int().optional(),
  // Rule edits ("all" / "this and following" scopes) and series endings
  // (until). Null clears the rule, turning the series into a plain item.
  recurrence: recurrenceSchema.nullable().optional(),
});

// ─── Steps ──────────────────────────────────────────────────────────
export const stepUpdateSchema = z.object({
  // Marks an occurrence the user moved via "just this one" — series-wide
  // edits skip detached steps.
  detached: z.boolean().optional(),
  label: safeText(1000).optional(),
  notes: safeText(10000).nullable().optional(),
  status: z.enum(["todo", "in_progress", "done", "blocked"]).optional(),
  day_offset: z.number().int().min(0).max(3650).optional(),
  duration_min: z.number().int().min(0).max(1440).nullable().optional(),
  time_of_day: timeOfDay.nullable().optional(),
  /**
   * ⚠️ Bounded to an ISO-8601 UTC instant on purpose, and it must stay bounded.
   *
   * This value is never parsed as a date before it is used — it is compared
   * LEXICOGRAPHICALLY, both in SQL (`listDoneStepsSince`'s
   * `completed_at >= ?`) and in the client's completed-history sort
   * (`localeCompare` in `components/gantt/board.tsx`). So a value that is not
   * in this exact shape does not throw and does not show up wrong: it sorts
   * somewhere arbitrary and silently drops the step out of the completed
   * history for good.
   *
   * The column is plain `TEXT`, and `STRICT` constrains the type but says
   * nothing about the format, so this regex is the only thing checking it. The
   * one producer is `new Date().toISOString()`, which this matches exactly.
   */
  completed_at: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
      "must be an ISO-8601 UTC instant",
    )
    .nullable()
    .optional(),
});

// ─── Item move ──────────────────────────────────────────────────────
/**
 * ⚠️ There is deliberately NO version / expectation field on this schema, and
 * none may be added back.
 *
 * A stale-write precondition ("land this only if the row still carries the
 * `updated_at` I read") answers a question that cannot arise here: one process
 * owns the database file and every write goes through it, so a row can only
 * have moved because of a write this same session already made. Every
 * rejection such a guard produced would be a false one, and the caller that
 * suffers most is undo — which restores a snapshot OVER current state by
 * definition, so the row has moved every single time.
 *
 * `schemas.test.ts` holds a compile-time assertion that `stepUpdates` rejects
 * an `expected_updated_at` key, so re-adding one fails the build.
 */
export const applyItemMoveSchema = z.object({
  itemId: uuid,
  stepUpdates: z
    .array(
      z.object({
        id: uuid,
        day_offset: z.number().int().min(0).max(3650),
      }),
    )
    .max(730),
  newStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  newDuration: z.number().int().min(1).max(730).optional(),
  newDeadlineOffset: z.number().int().min(0).max(3650).optional(),
  /**
   * How far the recurrence RULE itself moved. `0` for every gesture except a
   * scope-all weekday rotation.
   *
   * ⚠️ REQUIRED, and deliberately so. It cannot be derived server-side: a
   * rotation and a user arrow-shifting one cell arrive here in the IDENTICAL
   * shape (`stepUpdates`, no `newStartDate`) and need OPPOSITE
   * `origin_day_offset` behaviour — shift vs freeze. Only the caller knows
   * which gesture happened.
   *
   * It was `.optional()` with a `?? 0` in the action, on the reasoning that 0
   * is the *true* value for every other caller — which is true, and was still
   * wrong. The one caller that needed a non-zero value simply didn't pass it,
   * the default silently supplied 0, and every origin froze through a rotation:
   * the materializer then finds no origin at the new slot and mints a duplicate
   * on top of each occurrence that already moved (~9, one per live series). It
   * took a reviewer sweep to notice, because nothing failed.
   *
   * So: required. Omitting it is now a compile error at every call site rather
   * than a silent freeze. **A correct default is still a default: it answers
   * for a caller who never spoke.**
   */
  ruleDelta: z.number().int().min(-3650).max(3650),
});

/**
 * The action's input type. Actions elsewhere take `unknown` and lean on zod
 * alone, which is the right security boundary and a poor mechanism: zod strips
 * unknown keys and defaults missing ones **silently**, so a caller that forgets
 * `ruleDelta` gets a working call with the wrong answer. Typing this one input
 * moves that failure to compile time. zod still parses at runtime — the trust
 * boundary is unchanged; this only helps honest callers, which is exactly who
 * got it wrong.
 */
export type ApplyItemMoveInput = z.input<typeof applyItemMoveSchema>;

// ─── Deadlines ──────────────────────────────────────────────────────
export const deadlineCreateSchema = z.object({
  // Same id-restore story as blockCreateSchema — supports undo.
  id: uuid.optional(),
  // Required board scope; deadlines are standalone so they carry their own
  // board_id. The client supplies it from the board it is looking at.
  board_id: uuid,
  name: safeText(200).min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  color: hexColor.optional(),
});

// ─── Settings ───────────────────────────────────────────────────────
// Settings JSON is bounded by a serialized-size check in the action.
export const settingsPatchSchema = z.record(z.string(), z.unknown());
