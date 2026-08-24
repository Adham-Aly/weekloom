import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  settingsDelta,
} from "@/lib/types/settings";

/**
 * `settingsDelta` exists because `updateSettings` MERGES its patch, so a patch
 * carrying every key is a full-document overwrite. The Settings form used to
 * send exactly that, which made a stale surface destructive: hydrated when it
 * opened, it rewrote all thirty-odd fields from that snapshot the moment
 * anything in it changed — reverting whatever had been set elsewhere.
 *
 * These tests pin the two properties that fix depends on: the patch names ONLY
 * what changed, and an unchanged snapshot produces no patch at all (so the
 * form's autosave skips the round trip instead of issuing a no-op overwrite).
 */
describe("settingsDelta", () => {
  it("returns only the keys that changed", () => {
    const before = { ...DEFAULT_SETTINGS, theme: "light" as const, colW: 89 };
    const after = { ...before, theme: "dark" as const };
    expect(settingsDelta(before, after)).toEqual({ theme: "dark" });
  });

  it("returns an empty patch when nothing moved", () => {
    expect(settingsDelta(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toEqual({});
  });

  it("compares array values structurally, not by reference", () => {
    const before = { ...DEFAULT_SETTINGS, pinnedItemIds: ["a", "b"] };
    // A fresh array with identical contents is NOT a change; reference
    // equality would report one on every render and defeat the delta.
    const same = { ...before, pinnedItemIds: ["a", "b"] };
    expect(settingsDelta(before, same)).toEqual({});
    const moved = { ...before, pinnedItemIds: ["b"] };
    expect(settingsDelta(before, moved)).toEqual({ pinnedItemIds: ["b"] });
  });

  /**
   * THE REGRESSION ITSELF. A surface hydrated when the theme was "light" then
   * changed only its own field; a whole-object save would carry `light` along
   * and revert the newer value. The delta must not mention `theme`.
   */
  it("a stale surface changing one field does not carry the fields it never touched", () => {
    const hydrated = { ...DEFAULT_SETTINGS, theme: "light" as const };
    const afterItsOwnEdit = { ...hydrated, colW: 120 };
    const patch = settingsDelta(hydrated, afterItsOwnEdit);
    expect(patch).toEqual({ colW: 120 });
    expect(Object.keys(patch)).not.toContain("theme");
  });

  it("ignores keys that are not part of the settings shape", () => {
    const before = { ...DEFAULT_SETTINGS };
    const after = { ...DEFAULT_SETTINGS, bogus: 1 } as never;
    expect(settingsDelta(before, after)).toEqual({});
  });
});

/**
 * The three keys the board used to keep in `localStorage`.
 *
 * ═══ WHY THEY ARE IN THE DATABASE ═════════════════════════════════════════
 *
 * `localStorage` is partitioned by ORIGIN, and an origin contains a PORT. The
 * desktop shell binds a loopback port chosen at runtime, so anything kept in
 * `localStorage` is only as durable as that port number is. Chip mode, the
 * collapsed-item set and the last-used lane are all things a person set on
 * purpose and expects to find again, and none of them had a row anywhere —
 * so a port that moved silently re-expanded every item and reset every chip.
 *
 * They are ordinary settings keys now, which means they are covered by the
 * one rule this whole module exists to enforce: callers send a DELTA, never a
 * hydrated document. These cases pin the two properties the board depends on
 * — a real change is named, and a no-op change is NOT — because the board
 * writes them on every chevron click and a spurious patch there is a write
 * amplification into a Server Action round trip.
 *
 * ⚠️ Deliberately NOT moved, and there is no test for them here because there
 * is nothing in this module to test: `gantt:theme` (a pre-hydration cache the
 * inline bootstrap script reads before React exists, and which cannot read
 * SQLite), and the per-day fired-notification ledger and debug flag, which are
 * throwaway.
 */
describe("the board-owned settings keys", () => {
  it.each([
    ["chipModeByBlock", { a: "E" as const }],
    ["collapsedItemIds", ["item-1", "item-2"]],
    ["lastBlockId", "block-9"],
  ])("%s is part of the resolved shape, so it survives a merge", (key, v) => {
    // Absent from storage → the default, never `undefined`. A missing default
    // would make `ResolvedSettings` a lie and hand the board an undefined it
    // would have to guard at every read.
    expect(DEFAULT_SETTINGS).toHaveProperty(key);
    expect(
      mergeSettings({ [key]: v })[key as keyof typeof DEFAULT_SETTINGS],
    ).toEqual(v);
  });

  it("defaults to empty rather than absent, so a first run has no undefined", () => {
    const fresh = mergeSettings(null);
    expect(fresh.chipModeByBlock).toEqual({});
    expect(fresh.collapsedItemIds).toEqual([]);
    expect(fresh.lastBlockId).toBeNull();
  });

  it("names a collapsed-item change and carries nothing it did not touch", () => {
    const before = { ...DEFAULT_SETTINGS, theme: "light" as const, colW: 120 };
    const after = { ...before, collapsedItemIds: ["item-1"] };
    const patch = settingsDelta(before, after);
    expect(patch).toEqual({ collapsedItemIds: ["item-1"] });
    // THE REGRESSION THIS GUARDS: collapsing one row must not rewrite the
    // theme or the column width from this surface's own snapshot.
    expect(Object.keys(patch)).not.toContain("theme");
    expect(Object.keys(patch)).not.toContain("colW");
  });

  it("names a chip-mode change per block rather than replacing the map", () => {
    const before = {
      ...DEFAULT_SETTINGS,
      chipModeByBlock: { a: "T" as const },
    };
    const after = {
      ...before,
      chipModeByBlock: { a: "T" as const, b: "E" as const },
    };
    expect(settingsDelta(before, after)).toEqual({
      chipModeByBlock: { a: "T", b: "E" },
    });
  });

  it("⚠️ collapsing and re-expanding the same row produces NO patch", () => {
    // The board writes these on every chevron click. A delta that reported an
    // unchanged Set as changed would issue a Server Action round trip per
    // click, which is exactly what moving off localStorage must not cost.
    const before = { ...DEFAULT_SETTINGS, collapsedItemIds: ["a", "b"] };
    const sameContents = { ...before, collapsedItemIds: ["a", "b"] };
    expect(settingsDelta(before, sameContents)).toEqual({});

    const reallyChanged = { ...before, collapsedItemIds: ["a"] };
    expect(settingsDelta(before, reallyChanged)).toEqual({
      collapsedItemIds: ["a"],
    });
  });

  it("treats clearing the last-used lane as a real change, not as absence", () => {
    // `lastBlockId` is legitimately null, and `null` must SET the key rather
    // than be mistaken for "unchanged" — the same property `activeBoardId`
    // depends on.
    const before = { ...DEFAULT_SETTINGS, lastBlockId: "block-1" };
    const cleared = { ...before, lastBlockId: null };
    expect(settingsDelta(before, cleared)).toEqual({ lastBlockId: null });
  });
});
