import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import { DbInvalidInputError } from "@/lib/db/errors";
import type {
  Block,
  Board,
  Deadline,
  Item,
  Recurrence,
  Step,
  TaskStatus,
} from "@/lib/types/database";

/**
 * The single place SQLite storage classes become domain types, and the single
 * place domain values become bind parameters.
 *
 * **Three rules bind every function in the data layer. All three are runtime
 * throws or silent wrong answers, and `components/**` has no unit coverage, so
 * nothing downstream would catch them.**
 *
 * 1. ⚠️ **A JS `boolean` cannot be bound.** `node:sqlite` throws
 *    `"Provided value cannot be bound to SQLite parameter N."` Booleans go
 *    through `encBool` and reach SQLite as `0 | 1`.
 * 2. ⚠️ **`undefined` cannot be bound either** — same throw. A `Partial<Row>`
 *    patch therefore has its absent keys **omitted from the SQL**
 *    (`buildPatch`), producing a shorter statement rather than a bind error.
 * 3. ⚠️ **Every read goes through its table's mapper.** `DatabaseSync` returns
 *    null-prototype objects; a mapper builds a fresh plain literal, which is
 *    also what makes the rows safe to hand to a Server Component as props.
 *    Skipping the mapper ships `0`/`1` into React — and because `0` is falsy,
 *    `archived ? …` *appears* to work while `is_system === true` silently fails.
 *    That asymmetry is exactly why the mapper is mandatory rather than tidy.
 *
 * A fourth, about time: `updated_at` is set by the write helpers here, not by a
 * trigger. SQLite has no `NEW.x := …`, and an `AFTER UPDATE` trigger re-enters
 * the same table and needs a recursion guard for no gain.
 */

export type SqliteRow = Record<string, SQLOutputValue>;

// ─── Reading: storage class → domain value ───────────────────────────────

function asText(v: SQLOutputValue): string {
  return typeof v === "string" ? v : String(v);
}

function asTextOrNull(v: SQLOutputValue): string | null {
  return v == null ? null : asText(v);
}

/** ⚠️ `Number` on purpose: a large INTEGER column comes back as a `bigint`. */
function asInt(v: SQLOutputValue): number {
  return Number(v);
}

function asIntOrNull(v: SQLOutputValue): number | null {
  return v == null ? null : asInt(v);
}

/** ⚠️ `0` is falsy and `1` is truthy, but so is the string `"0"`. Compare. */
function asBool(v: SQLOutputValue): boolean {
  return asInt(v) === 1;
}

/**
 * ⚠️ Wrapped on purpose: one corrupted `recurrence` value must not make a whole
 * board unrenderable. A bad row degrades to "not a series" and says so in the
 * log; it does not throw out of a page render.
 */
function asRecurrence(v: SQLOutputValue, itemId: string): Recurrence | null {
  if (v == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(asText(v));
  } catch {
    console.error("[db] unparseable recurrence", { itemId });
    return null;
  }
  // A `json_valid` CHECK admits `[1,2]` and `"x"` as happily as an object, so
  // parsing successfully is not the same as having a rule. Casting either into
  // `Recurrence` would hand the materializer a `days` of `undefined`.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("[db] recurrence is not a rule object", { itemId });
    return null;
  }
  return parsed as Recurrence;
}

export function toBoard(r: SqliteRow): Board {
  return {
    id: asText(r.id),
    name: asText(r.name),
    color: asTextOrNull(r.color),
    icon: asTextOrNull(r.icon),
    archived: asBool(r.archived),
    sort_order: asInt(r.sort_order),
    created_at: asText(r.created_at),
    updated_at: asText(r.updated_at),
  };
}

export function toBlock(r: SqliteRow): Block {
  return {
    id: asText(r.id),
    board_id: asText(r.board_id),
    name: asText(r.name),
    color: asText(r.color),
    sort_order: asInt(r.sort_order),
    collapsed: asBool(r.collapsed),
    is_system: asBool(r.is_system),
    icon: asTextOrNull(r.icon),
    archived: asBool(r.archived),
    created_at: asText(r.created_at),
    updated_at: asText(r.updated_at),
  };
}

export function toItem(r: SqliteRow): Item {
  const id = asText(r.id);
  return {
    id,
    board_id: asText(r.board_id),
    block_id: asTextOrNull(r.block_id),
    prev_block_id: asTextOrNull(r.prev_block_id),
    deadline_id: asTextOrNull(r.deadline_id),
    title: asText(r.title),
    start_date: asText(r.start_date),
    duration_days: asInt(r.duration_days),
    deadline_offset: asInt(r.deadline_offset),
    color: asTextOrNull(r.color),
    sort_order: asInt(r.sort_order),
    recurrence: asRecurrence(r.recurrence, id),
    created_at: asText(r.created_at),
    updated_at: asText(r.updated_at),
  };
}

export function toStep(r: SqliteRow): Step {
  return {
    id: asText(r.id),
    item_id: asText(r.item_id),
    board_id: asText(r.board_id),
    day_offset: asInt(r.day_offset),
    label: asText(r.label),
    time_of_day: asTextOrNull(r.time_of_day),
    duration_min: asIntOrNull(r.duration_min),
    notes: asTextOrNull(r.notes),
    status: asText(r.status) as TaskStatus,
    completed_at: asTextOrNull(r.completed_at),
    detached: asBool(r.detached),
    // ⚠️ `asIntOrNull`, never `asInt`: null means "not a rule-generated
    // occurrence" and coercing it to 0 would make the materializer treat a
    // manually-added step as the series' founding occurrence.
    origin_day_offset: asIntOrNull(r.origin_day_offset),
    created_at: asText(r.created_at),
    updated_at: asText(r.updated_at),
  };
}

export function toDeadline(r: SqliteRow): Deadline {
  return {
    id: asText(r.id),
    board_id: asText(r.board_id),
    name: asText(r.name),
    date: asText(r.date),
    color: asText(r.color),
    created_at: asText(r.created_at),
  };
}

// ─── Writing: domain value → bind parameter ──────────────────────────────

/** ⚠️ Binding a raw JS boolean throws. This is the only route to a bool column. */
export function bindBool(v: boolean): 0 | 1 {
  return v ? 1 : 0;
}

export type Encoder = (v: unknown) => SQLInputValue;

export const encText: Encoder = (v) => String(v);
export const encTextOrNull: Encoder = (v) => (v == null ? null : String(v));
export const encInt: Encoder = (v) => Math.trunc(Number(v));
export const encIntOrNull: Encoder = (v) =>
  v == null ? null : Math.trunc(Number(v));
export const encBool: Encoder = (v) => bindBool(Boolean(v));
export const encJsonOrNull: Encoder = (v) =>
  v == null ? null : JSON.stringify(v);

/**
 * Turn a patch object into the columns and values of a `SET` clause.
 *
 * ⚠️ **Keys whose value is `undefined` are dropped, not bound.** Binding
 * `undefined` throws, and a `Partial<Row>` built by spreading optional fields
 * routinely carries such keys. The resulting statement is shorter rather than
 * broken — `updateBlockRow(id, { name: "x" })` writes one column, never eleven.
 *
 * An unrecognised key throws rather than being ignored, for two reasons.
 * Silently dropping a column the caller asked to write is the shape of bug where
 * a setting "doesn't do anything" — and every caller upstream has already been
 * through a Zod allowlist, so an unknown key here means the two disagree.
 *
 * ⚠️ **The encoder lookup is also what makes the generated SQL safe.** Column
 * names are interpolated into the statement (SQLite has no placeholder for an
 * identifier), and `Object.keys(patch)` is caller-controlled at runtime. Only a
 * key that has an encoder in this table's module-level record ever reaches the
 * string, so the allowlist is the boundary. Do not relax this into an
 * `if (!encode) continue`.
 */
export function buildPatch<K extends string>(
  patch: Partial<Record<K, unknown>>,
  encoders: Readonly<Record<K, Encoder>>,
): { columns: K[]; values: SQLInputValue[] } {
  const columns: K[] = [];
  const values: SQLInputValue[] = [];
  for (const key of Object.keys(patch) as K[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const encode = encoders[key];
    if (!encode) {
      throw new DbInvalidInputError(`not a writable column: ${key}`);
    }
    columns.push(key);
    values.push(encode(value));
  }
  return { columns, values };
}

/**
 * The same encoding, for an insert: `base` carries the server-set columns (id
 * and the timestamps) and `values` the caller-supplied ones, with absent keys
 * omitted exactly as in a patch so the row falls back to its schema default.
 */
export function buildInsert<K extends string>(
  values: Partial<Record<K, unknown>>,
  encoders: Readonly<Record<K, Encoder>>,
  base: Record<string, SQLInputValue>,
): Record<string, SQLInputValue> {
  const out: Record<string, SQLInputValue> = { ...base };
  const { columns, values: encoded } = buildPatch(values, encoders);
  columns.forEach((c, i) => {
    out[c] = encoded[i];
  });
  return out;
}

/**
 * `INSERT … RETURNING *`, optionally upserting on the primary key.
 *
 * The upsert exists so a repeated create — an undo that restores a deleted row
 * by its original id, or a caller that retries — lands the same row rather than
 * failing on the primary key. ⚠️ It updates **only the columns supplied**, so a
 * partial re-create cannot reset a column the caller said nothing about back to
 * its schema default.
 *
 * `table` and `immutable` come from module-level literals in this package and
 * never from input; `values`' keys come from the same literals via `buildPatch`.
 * Interpolating them is safe by construction and there is no parameterised form
 * of an identifier in SQLite.
 */
export function insertRow(
  db: DatabaseSync,
  table: string,
  values: Record<string, SQLInputValue>,
  opts: { upsert: boolean; immutable?: readonly string[] } = { upsert: false },
): SqliteRow {
  const columns = Object.keys(values);
  const immutable = opts.immutable ?? ["id", "created_at"];
  const updatable = columns.filter((c) => !immutable.includes(c));
  const conflict =
    opts.upsert && updatable.length > 0
      ? ` ON CONFLICT(id) DO UPDATE SET ${updatable
          .map((c) => `${c} = excluded.${c}`)
          .join(", ")}`
      : "";
  const sql =
    `INSERT INTO ${table} (${columns.join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")})${conflict} RETURNING *`;
  const row = db.prepare(sql).get(...columns.map((c) => values[c]));
  if (!row) {
    // Unreachable with `RETURNING *` on a landed row; if it ever happens the
    // caller must not receive a fabricated one.
    throw new Error(`insert into ${table} returned no row`);
  }
  return row;
}
