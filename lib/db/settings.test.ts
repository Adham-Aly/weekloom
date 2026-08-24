import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/connection";
import { mergeSettingsPatch, readSettings } from "@/lib/db/settings";
import { setUpTempDb } from "@/lib/db/test-support";

setUpTempDb();

describe("readSettings", () => {
  it("returns {} on a database nobody has written to", () => {
    // An absent document and an empty one mean the same thing to every reader,
    // and `lib/types/settings.ts` resolves defaults on top either way.
    expect(readSettings()).toEqual({});
  });
});

describe("mergeSettingsPatch", () => {
  it("the first write creates the singleton row", () => {
    mergeSettingsPatch({ theme: "dark" });
    expect(readSettings()).toEqual({ theme: "dark" });
    expect(
      getDb().prepare("SELECT count(*) AS n FROM user_settings").get(),
    ).toMatchObject({ n: 1 });
  });

  it("merges over the stored document and leaves untouched keys alone", () => {
    mergeSettingsPatch({ theme: "dark", slotMin: 30, futureDays: 30 });
    mergeSettingsPatch({ theme: "light" });
    expect(readSettings()).toEqual({
      theme: "light",
      slotMin: 30,
      futureDays: 30,
    });
  });

  it("⚠️ a null value SETS the key to null and does not REMOVE it", () => {
    // This is the `json_patch` proof, and it is measured rather than assumed:
    // `json_patch('{"a":1,"b":2}', '{"b":null}')` returns `{"a":1}` — SQLite
    // removes a null-valued key. `activeBoardId` and `lastBlockId` are
    // legitimately null, and `settingsDelta` emits them by value when the user
    // clears one. If someone "simplifies" mergeSettingsPatch to json_patch,
    // this test is what goes red.
    mergeSettingsPatch({ activeBoardId: "board-1", lastBlockId: "block-9" });
    mergeSettingsPatch({ activeBoardId: null });

    const after = readSettings();
    expect("activeBoardId" in after).toBe(true);
    expect(after.activeBoardId).toBeNull();
    expect(after.lastBlockId).toBe("block-9");

    // And the stored document really carries the key, not just the reader.
    const raw = getDb()
      .prepare("SELECT settings FROM user_settings WHERE id = 1")
      .get() as { settings: string };
    expect(JSON.parse(raw.settings)).toHaveProperty("activeBoardId", null);
  });

  it("is shallow — a nested object is replaced, not deep-merged", () => {
    // Matching the semantics the app was written against exactly. A deep merge
    // would make it impossible to remove a key from a nested object.
    mergeSettingsPatch({ gantt: { rowHeight: 32, gridlines: true } });
    mergeSettingsPatch({ gantt: { rowHeight: 40 } });
    expect(readSettings().gantt).toEqual({ rowHeight: 40 });
  });

  it("two sequential merges from stale snapshots are additive on disjoint keys", () => {
    // The race this replaces: setActiveBoard fires on every board mount while
    // the debounced settings autosave is in flight, and the stale read won.
    mergeSettingsPatch({ theme: "dark" });
    mergeSettingsPatch({ activeBoardId: "board-1" });
    mergeSettingsPatch({ accentColor: "#ff0000" });
    expect(readSettings()).toEqual({
      theme: "dark",
      activeBoardId: "board-1",
      accentColor: "#ff0000",
    });
  });

  it("an empty patch changes nothing", () => {
    mergeSettingsPatch({ theme: "dark" });
    mergeSettingsPatch({});
    expect(readSettings()).toEqual({ theme: "dark" });
  });

  it("bumps updated_at on every merge", () => {
    mergeSettingsPatch({ theme: "dark" });
    const first = getDb()
      .prepare("SELECT updated_at FROM user_settings WHERE id = 1")
      .get() as { updated_at: string };
    mergeSettingsPatch({ theme: "light" });
    const second = getDb()
      .prepare("SELECT updated_at FROM user_settings WHERE id = 1")
      .get() as { updated_at: string };
    expect(Date.parse(second.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(first.updated_at),
    );
  });

  it("the schema refuses a second settings row", () => {
    // "Singleton" is a property of the schema here, not a habit of the code.
    mergeSettingsPatch({ theme: "dark" });
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO user_settings (id, settings, updated_at) VALUES (2, '{}', 't')",
        )
        .run(),
    ).toThrow(/CHECK/i);
  });
});
