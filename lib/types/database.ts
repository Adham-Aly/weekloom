/**
 * The row types of the local database, hand-written to match `lib/db/schema.ts`.
 *
 * These two files are the *only* description of the schema and they live in the
 * same package on purpose, so they cannot drift apart the way a generated type
 * file drifts from the database it was generated against.
 * `lib/db/schema.test.ts` asserts the agreement mechanically: for every table,
 * the columns SQLite reports in `PRAGMA table_info` are exactly the keys the
 * row mapper produces.
 *
 * Storage classes are *not* what appears here. SQLite has no boolean and no
 * JSON type, so `archived`, `collapsed`, `is_system` and `detached` are stored
 * as `INTEGER 0/1` and `items.recurrence` as `TEXT`. `lib/db/rows.ts` is the
 * single place that conversion happens; nothing above it ever sees a number
 * where these types promise a boolean.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** The four states a step can be in. A CHECK constraint pins the same set. */
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

/**
 * Recurrence rule stored on a series item (`items.recurrence`).
 * The series' occurrences are its steps, materialized over a rolling
 * horizon; this rule is what generates them.
 */
export type Recurrence = {
  /** Weekdays the series fires on — JS getDay() numbering, 0 = Sunday. */
  days: number[];
  /** Time of day for each occurrence ("HH:MM", 24h). */
  time: string;
  /** Occurrence length in minutes (null = untimed default). */
  durationMin: number | null;
  /**
   * Series end (ISO date, inclusive). Set when the user deletes "this and
   * following" — materialization never extends past it. Absent = open.
   */
  until?: string;
};

export type Board = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Block = {
  id: string;
  board_id: string;
  name: string;
  color: string;
  sort_order: number;
  collapsed: boolean;
  /**
   * The Completed lane. Rendered by `completed-section.tsx` rather than as an
   * ordinary block, and `deleteBlock` refuses to remove it.
   */
  is_system: boolean;
  icon: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type Item = {
  id: string;
  board_id: string;
  /** Null = a calendar-only task: it renders in the Calendar, not the Gantt. */
  block_id: string | null;
  prev_block_id: string | null;
  deadline_id: string | null;
  title: string;
  /** Floating local date, `YYYY-MM-DD`. Never UTC-normalised. */
  start_date: string;
  duration_days: number;
  deadline_offset: number;
  color: string | null;
  sort_order: number;
  recurrence: Recurrence | null;
  created_at: string;
  updated_at: string;
};

export type Step = {
  id: string;
  item_id: string;
  board_id: string;
  /** Where the USER put this step, measured in days from `items.start_date`. */
  day_offset: number;
  label: string;
  /** Floating local wall clock, `HH:MM` or `HH:MM:SS`. */
  time_of_day: string | null;
  duration_min: number | null;
  notes: string | null;
  status: TaskStatus;
  completed_at: string | null;
  detached: boolean;
  /**
   * Where the RULE put this occurrence, in the same coordinates as
   * `day_offset`. They are equal until the user moves the occurrence.
   *
   * ⚠️ Nullable with no default, and **null is meaningful**: it says "this step
   * is not a rule-generated occurrence" (an `addStepAt` step, a `resizeItem`
   * tail row). ⚠️ **Negative values are correct**, not a bug to clamp — when an
   * item's `start_date` slides later, a fixed occurrence's offset from that
   * start goes down and may pass zero.
   */
  origin_day_offset: number | null;
  created_at: string;
  updated_at: string;
};

export type Deadline = {
  id: string;
  board_id: string;
  name: string;
  /** Floating local date, `YYYY-MM-DD`. */
  date: string;
  color: string;
  /**
   * ⚠️ There is deliberately no `updated_at` here and the table must not gain
   * one. Deadlines are created and deleted, never versioned, and nothing in
   * the app reads a deadline's mtime.
   */
  created_at: string;
};
