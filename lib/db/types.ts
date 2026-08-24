import type { Recurrence, TaskStatus } from "@/lib/types/database";

/**
 * The insert and patch shapes the data layer accepts.
 *
 * They live here rather than beside the row types because that is where their
 * consumers are: `lib/types/database.ts` describes what a row *is* (twelve
 * components import those), while these describe what may be *written*, which is
 * a narrower and different question. Nothing is duplicated between the two files.
 *
 * Two rules hold throughout:
 *
 * - **`id` is optional and caller-minted.** Ids are minted on the client so an
 *   optimistic row and the row that lands share a React key. ⚠️ Do not switch to
 *   a server default: the two rows would diverge and the optimistic one would
 *   remount when the answer arrived.
 * - **Timestamps are absent.** `created_at` and `updated_at` are set by the
 *   write helpers, and accepting them from a caller is how a row acquires a
 *   mtime that does not describe when it was written.
 */

export type BoardInsert = {
  id?: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  archived?: boolean;
  sort_order?: number;
};

export type BoardPatch = {
  name?: string;
  color?: string | null;
  icon?: string | null;
  archived?: boolean;
  sort_order?: number;
};

export type BlockInsert = {
  id?: string;
  board_id: string;
  name: string;
  color?: string;
  sort_order?: number;
  collapsed?: boolean;
  /** Only the first-run seed sets this; there is no caller-facing route to it. */
  is_system?: boolean;
  icon?: string | null;
  archived?: boolean;
};

export type BlockPatch = {
  name?: string;
  color?: string;
  sort_order?: number;
  collapsed?: boolean;
  icon?: string | null;
  archived?: boolean;
};

export type ItemInsert = {
  id?: string;
  board_id: string;
  block_id?: string | null;
  prev_block_id?: string | null;
  deadline_id?: string | null;
  title: string;
  start_date: string;
  duration_days?: number;
  deadline_offset?: number;
  color?: string | null;
  sort_order?: number;
  recurrence?: Recurrence | null;
};

export type ItemPatch = {
  block_id?: string | null;
  prev_block_id?: string | null;
  deadline_id?: string | null;
  title?: string;
  start_date?: string;
  duration_days?: number;
  deadline_offset?: number;
  color?: string | null;
  sort_order?: number;
  recurrence?: Recurrence | null;
};

export type StepInsert = {
  id?: string;
  item_id: string;
  board_id: string;
  day_offset: number;
  label?: string;
  time_of_day?: string | null;
  duration_min?: number | null;
  notes?: string | null;
  status?: TaskStatus;
  completed_at?: string | null;
  detached?: boolean;
  /**
   * ⚠️ Set this **only** for a rule-generated occurrence. A manually added step
   * (`addStepAt`) and a `resizeItem` tail row must leave it absent: giving them
   * an origin makes the materializer read them as occurrences and its watermark
   * jumps to wherever the user happened to put one.
   */
  origin_day_offset?: number | null;
};

/**
 * ⚠️ `origin_day_offset` is deliberately absent from the patch shape. It is
 * maintained in exactly two places — `lib/db/rpc/apply-item-move.ts`, which
 * rebases it, and `lib/db/rpc/materialize-series.ts`, which mints it — and a
 * third writer is how the column stops meaning "where the rule put this".
 */
export type StepPatch = {
  day_offset?: number;
  label?: string;
  time_of_day?: string | null;
  duration_min?: number | null;
  notes?: string | null;
  status?: TaskStatus;
  completed_at?: string | null;
  detached?: boolean;
};

export type DeadlineInsert = {
  id?: string;
  board_id: string;
  name: string;
  date: string;
  color?: string;
};
