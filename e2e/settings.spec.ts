import { expect, test } from "@playwright/test";
import { settingControl } from "./helpers";

/**
 * Settings persist, and one field does not revert another.
 *
 * ⚠️ **The second test is the whole point.** `updateSettings` MERGES its patch
 * into one JSON document, so every caller must send a DELTA. A form that posts
 * its whole hydrated state instead looks completely correct — until a second
 * field, changed at some other moment, is silently rewritten from a stale
 * snapshot. That failure has been measured and it presents to the user as "a
 * setting that doesn't do anything". `lib/types/settings.test.ts` pins
 * `settingsDelta`'s arithmetic; this pins the form actually using it, and the
 * form lives in `components/**`, which vitest cannot see at all.
 */
test.describe.configure({ mode: "serial" });

/** The Violet preset, verbatim from `ACCENT_PRESETS`. */
const VIOLET = "#8b5cf6";

test.describe("settings", () => {
  test("an accent colour survives a reload", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Accent color")).toBeVisible();

    const swatch = page.getByTitle("Custom color");
    // Positive control: the field starts on something other than the value
    // this test is about to set, so the assertion after the reload cannot be
    // satisfied by a page that never changed.
    await expect(swatch).not.toHaveValue(VIOLET);

    // ⚠️ Click the preset swatch — a real user gesture — rather than assigning
    // `input.value` and dispatching a synthetic event. React's input-value
    // tracker records a direct assignment, so the dispatched event is deduped
    // as a no-change and `onChange` never fires: MEASURED, the previous form of
    // this test set the value, saw no "Saved" ping, and the write never
    // happened.
    await page.getByTitle("Violet").click();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(page.getByTitle("Custom color")).toHaveValue(VIOLET);
  });

  test("changing one field does not revert another", async ({ page }) => {
    await page.goto("/settings");

    // Field A: a Gantt number the accent test never touches.
    const colW = settingControl(page, "Column width (px)").first();
    await colW.fill("48");
    await colW.blur();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    // Positive control: field A actually changed, so the assertion on field B
    // below is not passing because nothing was written at all.
    await expect(settingControl(page, "Column width (px)").first()).toHaveValue(
      "48",
    );

    // Field B: toggled AFTER field A, from a page that was hydrated before it.
    const gridlines = settingControl(page, "Show gridlines").first();
    await gridlines.click();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    // ⚠️ Field A must still be 48. If the form posted a whole document rather
    // than a delta, toggling B would have rewritten A from its stale snapshot.
    await expect(settingControl(page, "Column width (px)").first()).toHaveValue(
      "48",
    );
    // ⚠️ …and so must the accent from the previous test, which was written by a
    // DIFFERENT page load. That is the exact shape of the measured failure.
    await expect(page.getByTitle("Custom color")).toHaveValue(VIOLET);
  });

  test("the Settings page says where the data lives", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Data", { exact: true })).toBeVisible();
    await expect(page.getByText("~/.weekloom").first()).toBeVisible();
  });
});
