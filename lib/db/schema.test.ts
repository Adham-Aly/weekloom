import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/connection";
import { nowISO } from "@/lib/db/now";
import {
  toBlock,
  toBoard,
  toDeadline,
  toItem,
  toStep,
  type SqliteRow,
} from "@/lib/db/rows";
import { setUpTempDb } from "@/lib/db/test-support";

setUpTempDb();

const AT = "2026-08-23T12:00:00.000Z";

function board(id = randomUUID()): string {
  getDb()
    .prepare(
      "INSERT INTO boards (id, name, created_at, updated_at) VALUES (?, 'B', ?, ?)",
    )
    .run(id, AT, AT);
  return id;
}

function item(boardId: string, id = randomUUID()): string {
  getDb()
    .prepare(
      "INSERT INTO items (id, board_id, title, start_date, created_at, updated_at) " +
        "VALUES (?, ?, 'T', '2026-08-23', ?, ?)",
    )
    .run(id, boardId, AT, AT);
  return id;
}

describe("the connection", () => {
  it("is memoized — two calls return one handle", () => {
    expect(getDb()).toBe(getDb());
  });

  it("has foreign keys on and WAL journalling", () => {
    const db = getDb();
    expect(db.prepare("PRAGMA foreign_keys").get()).toMatchObject({
      foreign_keys: 1,
    });
    expect(db.prepare("PRAGMA journal_mode").get()).toMatchObject({
      journal_mode: "wal",
    });
  });

  it("reaches the current schema version on a fresh file", () => {
    expect(getDb().prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 1,
    });
  });
});

describe("constraints that must fire", () => {
  it("rejects a second system block of the same name on one board", () => {
    const b = board();
    const insert = getDb().prepare(
      "INSERT INTO blocks (id, board_id, name, is_system, created_at, updated_at) " +
        "VALUES (?, ?, 'Completed', 1, ?, ?)",
    );
    insert.run(randomUUID(), b, AT, AT);
    expect(() => insert.run(randomUUID(), b, AT, AT)).toThrow(/UNIQUE/i);
  });

  it("accepts the same system block name on a DIFFERENT board", () => {
    // The near-miss, pinned alongside the hit: the index is partial and scoped
    // per board. A plain UNIQUE(name) would pass the test above and break this.
    const insert = getDb().prepare(
      "INSERT INTO blocks (id, board_id, name, is_system, created_at, updated_at) " +
        "VALUES (?, ?, 'Completed', 1, ?, ?)",
    );
    insert.run(randomUUID(), board(), AT, AT);
    expect(() => insert.run(randomUUID(), board(), AT, AT)).not.toThrow();
  });

  it("accepts two ordinary lanes with the same name on one board", () => {
    // The other half of "partial": user lanes may share a name freely.
    const b = board();
    const insert = getDb().prepare(
      "INSERT INTO blocks (id, board_id, name, created_at, updated_at) " +
        "VALUES (?, ?, 'Work', ?, ?)",
    );
    insert.run(randomUUID(), b, AT, AT);
    expect(() => insert.run(randomUUID(), b, AT, AT)).not.toThrow();
  });

  it("rejects a status outside the four the app knows", () => {
    const b = board();
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO steps (id, item_id, board_id, day_offset, status, created_at, updated_at) " +
            "VALUES (?, ?, ?, 0, 'archived', ?, ?)",
        )
        .run(randomUUID(), item(b), b, AT, AT),
    ).toThrow(/CHECK/i);
  });

  it("rejects duration_days = 0", () => {
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO items (id, board_id, title, start_date, duration_days, created_at, updated_at) " +
            "VALUES (?, ?, 'T', '2026-08-23', 0, ?, ?)",
        )
        .run(randomUUID(), board(), AT, AT),
    ).toThrow(/CHECK/i);
  });

  it("rejects a negative day_offset", () => {
    const b = board();
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO steps (id, item_id, board_id, day_offset, created_at, updated_at) " +
            "VALUES (?, ?, ?, -1, ?, ?)",
        )
        .run(randomUUID(), item(b), b, AT, AT),
    ).toThrow(/CHECK/i);
  });

  it("⚠️ ACCEPTS a negative origin_day_offset", () => {
    // Not an oversight. When an item's start_date slides later, a fixed
    // occurrence's offset from that start goes down and may pass zero. A CHECK
    // here would turn a working drag into a 500, and clamping would collapse two
    // distinct occurrences onto one origin.
    const b = board();
    const i = item(b);
    getDb()
      .prepare(
        "INSERT INTO steps (id, item_id, board_id, day_offset, origin_day_offset, created_at, updated_at) " +
          "VALUES (?, ?, ?, 0, -3, ?, ?)",
      )
      .run(randomUUID(), i, b, AT, AT);
    expect(
      getDb()
        .prepare("SELECT origin_day_offset AS o FROM steps WHERE item_id = ?")
        .get(i),
    ).toMatchObject({ o: -3 });
  });

  it("⚠️ ACCEPTS two steps sharing one origin_day_offset", () => {
    // There is deliberately no UNIQUE(item_id, origin_day_offset): detached and
    // non-detached occurrences share the origin space, and a rotation that
    // rebases one onto a frozen one would otherwise fail the user's drag.
    const b = board();
    const i = item(b);
    const insert = getDb().prepare(
      "INSERT INTO steps (id, item_id, board_id, day_offset, origin_day_offset, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, 7, ?, ?)",
    );
    insert.run(randomUUID(), i, b, 7, AT, AT);
    expect(() => insert.run(randomUUID(), i, b, 20, AT, AT)).not.toThrow();
  });

  it("bounds a block icon at 64 characters", () => {
    const b = board();
    const insert = getDb().prepare(
      "INSERT INTO blocks (id, board_id, name, icon, created_at, updated_at) " +
        "VALUES (?, ?, 'L', ?, ?, ?)",
    );
    expect(() =>
      insert.run(randomUUID(), b, "x".repeat(64), AT, AT),
    ).not.toThrow();
    expect(() => insert.run(randomUUID(), b, "x".repeat(65), AT, AT)).toThrow(
      /CHECK/i,
    );
  });

  it("rejects a second settings row", () => {
    const insert = getDb().prepare(
      "INSERT INTO user_settings (id, settings, updated_at) VALUES (?, '{}', ?)",
    );
    insert.run(1, AT);
    expect(() => insert.run(2, AT)).toThrow(/CHECK/i);
  });

  it("rejects invalid JSON in items.recurrence", () => {
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO items (id, board_id, title, start_date, recurrence, created_at, updated_at) " +
            "VALUES (?, ?, 'T', '2026-08-23', 'not json', ?, ?)",
        )
        .run(randomUUID(), board(), AT, AT),
    ).toThrow(/CHECK/i);
  });

  it("STRICT rejects a string bound into an INTEGER column", () => {
    // Without STRICT, SQLite's type affinity would store "many" in sort_order
    // and every ORDER BY would quietly sort text against numbers.
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO boards (id, name, sort_order, created_at, updated_at) VALUES (?, 'B', ?, ?, ?)",
        )
        .run(randomUUID(), "many", AT, AT),
    ).toThrow(/cannot store TEXT value in INTEGER column/i);
  });
});

describe("the schema and the row types agree", () => {
  // ⚠️ The check that keeps `lib/types/database.ts` from drifting. The two files
  // are the only description of the schema; a column added to one and not the
  // other is invisible until something reads it.
  const TABLES: {
    table: string;
    insert: string;
    params: (boardId: string, itemId: string) => unknown[];
    map: (r: SqliteRow) => Record<string, unknown>;
  }[] = [
    {
      table: "boards",
      insert:
        "INSERT INTO boards (id, name, created_at, updated_at) VALUES (?, 'B', ?, ?) RETURNING *",
      params: () => [randomUUID(), AT, AT],
      map: toBoard,
    },
    {
      table: "blocks",
      insert:
        "INSERT INTO blocks (id, board_id, name, created_at, updated_at) VALUES (?, ?, 'L', ?, ?) RETURNING *",
      params: (b) => [randomUUID(), b, AT, AT],
      map: toBlock,
    },
    {
      table: "items",
      insert:
        "INSERT INTO items (id, board_id, title, start_date, created_at, updated_at) " +
        "VALUES (?, ?, 'T', '2026-08-23', ?, ?) RETURNING *",
      params: (b) => [randomUUID(), b, AT, AT],
      map: toItem,
    },
    {
      table: "steps",
      insert:
        "INSERT INTO steps (id, item_id, board_id, day_offset, created_at, updated_at) " +
        "VALUES (?, ?, ?, 0, ?, ?) RETURNING *",
      params: (b, i) => [randomUUID(), i, b, AT, AT],
      map: toStep,
    },
    {
      table: "deadlines",
      insert:
        "INSERT INTO deadlines (id, board_id, name, date, created_at) VALUES (?, ?, 'D', '2026-08-23', ?) RETURNING *",
      params: (b) => [randomUUID(), b, AT],
      map: toDeadline,
    },
  ];

  it.each(TABLES)("$table: every column reaches the mapped row", (spec) => {
    const b = board();
    const i = item(b);
    const row = getDb()
      .prepare(spec.insert)
      .get(...(spec.params(b, i) as string[]));
    expect(row).toBeTruthy();
    const columns = Object.keys(row as object).sort();
    const mapped = Object.keys(spec.map(row as SqliteRow)).sort();
    expect(mapped).toEqual(columns);
  });

  it("the mapper set covers every table in the schema", () => {
    // The coverage assertion: if a migration adds a table, this list is the
    // thing that must grow, and this test is what says so.
    const tables = getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => String((r as { name: string }).name));
    expect(tables).toEqual([
      "blocks",
      "boards",
      "deadlines",
      "items",
      "steps",
      "user_settings",
    ]);
    // Five of the six have a row mapper; `user_settings` is a JSON document
    // rather than a row type, so it deliberately has none.
    expect(TABLES.map((t) => t.table).sort()).toEqual([
      "blocks",
      "boards",
      "deadlines",
      "items",
      "steps",
    ]);
  });
});

describe("nowISO", () => {
  it("is a parseable ISO-8601 instant", () => {
    expect(Number.isNaN(Date.parse(nowISO()))).toBe(false);
  });
});
