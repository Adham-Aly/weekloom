import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/connection";
import { nowISO } from "@/lib/db/now";
import {
  buildInsert,
  buildPatch,
  encBool,
  encInt,
  encIntOrNull,
  encText,
  encTextOrNull,
  insertRow,
  toStep,
  type Encoder,
  type SqliteRow,
} from "@/lib/db/rows";
import { tx } from "@/lib/db/tx";
import type { StepInsert, StepPatch } from "@/lib/db/types";
import type { Step } from "@/lib/types/database";

const ENCODERS: Readonly<
  Record<
    keyof StepPatch | "item_id" | "board_id" | "origin_day_offset",
    Encoder
  >
> = {
  item_id: encText,
  board_id: encText,
  day_offset: encInt,
  label: encText,
  time_of_day: encTextOrNull,
  duration_min: encIntOrNull,
  notes: encTextOrNull,
  status: encText,
  completed_at: encTextOrNull,
  detached: encBool,
  origin_day_offset: encIntOrNull,
};

export function listStepsByBoard(boardId: string): Step[] {
  return getDb()
    .prepare(
      "SELECT * FROM steps WHERE board_id = ? ORDER BY item_id, day_offset, id",
    )
    .all(boardId)
    .map((r) => toStep(r as SqliteRow));
}

export function listStepsByItem(itemId: string): Step[] {
  return getDb()
    .prepare("SELECT * FROM steps WHERE item_id = ? ORDER BY day_offset, id")
    .all(itemId)
    .map((r) => toStep(r as SqliteRow));
}

/**
 * Steps for several items at once — what the materializer reads before planning.
 *
 * The placeholder list is built from `itemIds.length`, never by interpolating
 * the ids themselves. An empty list short-circuits: `IN ()` is a syntax error in
 * SQLite, and the honest answer to "steps of no items" is no steps.
 */
export function listStepsByItemIds(itemIds: string[]): Step[] {
  if (itemIds.length === 0) return [];
  const placeholders = itemIds.map(() => "?").join(", ");
  return getDb()
    .prepare(
      `SELECT * FROM steps WHERE item_id IN (${placeholders}) ORDER BY item_id, day_offset, id`,
    )
    .all(...itemIds)
    .map((r) => toStep(r as SqliteRow));
}

/**
 * Completed steps from `sinceISO` onward, for the home screen's activity grid
 * and streak counters.
 */
export function listDoneStepsSince(sinceISO: string): Step[] {
  return getDb()
    .prepare(
      "SELECT * FROM steps WHERE status = 'done' AND completed_at >= ? ORDER BY completed_at, id",
    )
    .all(sinceISO)
    .map((r) => toStep(r as SqliteRow));
}

export function getStep(id: string): Step | null {
  const row = getDb().prepare("SELECT * FROM steps WHERE id = ?").get(id);
  return row ? toStep(row as SqliteRow) : null;
}

function stepFields(row: StepInsert): Record<string, ReturnType<Encoder>> {
  const at = nowISO();
  const { id, ...rest } = row;
  return buildInsert(rest, ENCODERS, {
    id: id ?? randomUUID(),
    created_at: at,
    updated_at: at,
  });
}

export function upsertStep(row: StepInsert): Step {
  return toStep(insertRow(getDb(), "steps", stepFields(row), { upsert: true }));
}

/**
 * Upsert many steps as one unit. A create that half-applies leaves a task whose
 * days stop partway through, which reads to the user as data loss rather than as
 * a failed write.
 */
export function upsertSteps(rows: StepInsert[]): Step[] {
  if (rows.length === 0) return [];
  return tx((db) =>
    rows.map((row) =>
      toStep(insertRow(db, "steps", stepFields(row), { upsert: true })),
    ),
  );
}

/**
 * Insert many steps as one unit, failing on a duplicate id rather than
 * overwriting. Used where the ids are freshly minted, so a collision means
 * something is wrong rather than something is being retried.
 */
export function insertSteps(rows: StepInsert[]): Step[] {
  if (rows.length === 0) return [];
  return tx((db) =>
    rows.map((row) =>
      toStep(insertRow(db, "steps", stepFields(row), { upsert: false })),
    ),
  );
}

export function updateStepRow(id: string, patch: StepPatch): Step | null {
  const db = getDb();
  const { columns, values } = buildPatch(patch, ENCODERS);
  if (columns.length === 0) return getStep(id);
  const sql =
    `UPDATE steps SET ${columns.map((c) => `${c} = ?`).join(", ")}, ` +
    "updated_at = ? WHERE id = ? RETURNING *";
  const row = db.prepare(sql).get(...values, nowISO(), id);
  return row ? toStep(row as SqliteRow) : null;
}

export function deleteStepRow(id: string): void {
  getDb().prepare("DELETE FROM steps WHERE id = ?").run(id);
}

export function deleteStepsByIds(ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  getDb()
    .prepare(`DELETE FROM steps WHERE id IN (${placeholders})`)
    .run(...ids);
}
