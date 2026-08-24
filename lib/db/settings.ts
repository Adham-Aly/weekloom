import { getDb } from "@/lib/db/connection";
import { nowISO } from "@/lib/db/now";
import { tx } from "@/lib/db/tx";
import type { Json } from "@/lib/types/database";

/**
 * The settings document: one JSON blob in a one-row table.
 *
 * `readSettings()` on a database nobody has written to returns `{}` rather than
 * throwing or seeding — an absent document and an empty one mean the same thing
 * to every reader, and `lib/types/settings.ts` resolves defaults on top.
 */
export function readSettings(): Record<string, Json> {
  const row = getDb()
    .prepare("SELECT settings FROM user_settings WHERE id = 1")
    .get() as { settings?: string } | undefined;
  return parseSettings(row?.settings);
}

function parseSettings(raw: string | undefined): Record<string, Json> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, Json>;
    }
  } catch {
    // A CHECK constraint keeps this column valid JSON, so reaching here means
    // the file was edited by hand. Falling back to defaults loses the user's
    // settings; throwing loses the whole app. Say so and fall back.
    console.error("[db] unparseable settings document — falling back to {}");
    return {};
  }
  console.error("[db] settings document is not an object — falling back to {}");
  return {};
}

/**
 * Shallow-merge `patch` over the stored document.
 *
 * ## ⚠️ Every caller sends a DELTA, and the merge is what makes that safe
 *
 * A caller that sends its whole in-memory settings object overwrites every
 * field from whatever snapshot it hydrated with. Measured on the hosted
 * version: one surface changed the theme and silently reverted a preference a
 * different surface had set, presenting to the user as "a setting that doesn't
 * do anything". `settingsDelta` (`lib/types/settings.ts`) is what keeps the
 * callers honest; this function is what makes a delta land correctly.
 *
 * ## ⚠️ `json_patch()` must NOT be used here, and the reason is measured
 *
 * `select json_patch('{"a":1,"b":2}', '{"b":null}')` returns `{"a":1}` — SQLite
 * **removes** a key whose patch value is null, where the semantics this app was
 * written against **set it to JSON null**. `activeBoardId` and `lastBlockId`
 * are legitimately null, and `settingsDelta` emits them by value when the user
 * clears one. A TypeScript spread reproduces the intended semantics exactly and
 * is one line. `lib/db/settings.test.ts` pins it.
 *
 * ## Atomicity is not optional
 *
 * The previous read-merge-write raced: `setActiveBoard` fires on every board
 * mount while the debounced settings autosave is in flight, and the stale read
 * won. ⚠️ The read, the merge and the write are inside one `tx` with **no
 * `await` between them**, which is what makes the sequence indivisible — see
 * `lib/db/tx.ts`.
 *
 * Two callers editing the SAME key still race and last-writer-wins. That part is
 * correct and intended.
 */
export function mergeSettingsPatch(patch: Record<string, Json>): void {
  tx((db) => {
    const row = db
      .prepare("SELECT settings FROM user_settings WHERE id = 1")
      .get() as { settings?: string } | undefined;
    const merged = { ...parseSettings(row?.settings), ...patch };
    db.prepare(
      "INSERT INTO user_settings (id, settings, updated_at) VALUES (1, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at",
    ).run(JSON.stringify(merged), nowISO());
  });
}
