import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/connection";
import { MIGRATIONS, SCHEMA_VERSION, migrate } from "@/lib/db/schema";
import { setUpTempDb } from "@/lib/db/test-support";

setUpTempDb();

/** A bare in-memory handle, so a case can drive `migrate` without the app's. */
const scratch: DatabaseSync[] = [];
function fresh(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  scratch.push(db);
  return db;
}
afterEach(() => {
  while (scratch.length) scratch.pop()?.close();
});

function version(db: DatabaseSync): number {
  return Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
  );
}

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => String((r as { name: string }).name));
}

describe("migrate", () => {
  it("brings a fresh database to the current version", () => {
    const db = fresh();
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(version(db)).toBe(SCHEMA_VERSION);
    // And the same is true of the handle the app actually uses.
    expect(version(getDb())).toBe(SCHEMA_VERSION);
  });

  it("is a no-op on a second run", () => {
    // Re-running is what every launch does. If it were not a no-op the second
    // launch would fail on "table already exists".
    const db = fresh();
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(version(db)).toBe(SCHEMA_VERSION);
  });

  it("rolls a failing migration back: no partial tables, no bumped version", () => {
    // Make version 1 fail PARTWAY through rather than at its first statement, by
    // pre-creating a table it creates last. Without the transaction the earlier
    // CREATEs would survive with `user_version` still at 0, so every subsequent
    // launch would fail on "table already exists" — forever, and with no route
    // back short of deleting the user's file.
    const db = fresh();
    db.exec("CREATE TABLE user_settings (id INTEGER PRIMARY KEY)");
    const before = tableNames(db);

    expect(() => migrate(db)).toThrow(/already exists/i);
    expect(version(db)).toBe(0);
    expect(tableNames(db)).toEqual(before);
  });

  it("has strictly increasing versions starting at 1", () => {
    expect(MIGRATIONS[0].version).toBe(1);
    for (let i = 1; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i].version).toBeGreaterThan(MIGRATIONS[i - 1].version);
    }
    expect(SCHEMA_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  });

  it("refuses a database written by a newer build", () => {
    // A user-owned file. Running against a schema this build does not understand
    // corrupts data slowly and silently; refusing is legible and cheap.
    const db = fresh();
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/newer version of Weekloom/);
    expect(version(db)).toBe(SCHEMA_VERSION + 1);
  });
});
