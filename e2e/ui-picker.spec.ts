import { expect, test, type Page } from "@playwright/test";
import { boardCard, settingControl, withWrite } from "./helpers";

/**
 * The board picker honours the settings document, and writes back to it.
 *
 * ⚠️ **Why this file exists.** `/app` — the picker — is a first-class surface
 * of this application, not a shell around the board, and it used to know
 * nothing about `user_settings`. Two things followed, both MEASURED against the
 * real standalone build:
 *
 *  - `<Personalization>` was mounted on the board and on Settings and nowhere
 *    else, so with `accentColor` `#0f7a55` on disk the board and Settings were
 *    green and the picker still drew the stock blue.
 *  - its theme toggle read `document.dataset.theme` (i.e. `localStorage`) and
 *    wrote only `localStorage`. A window with an empty store opened the picker
 *    DARK with `theme: "light"` on disk and stayed wrong for the whole visit,
 *    and a toggle made here was reverted the moment a board opened.
 *
 * ⚠️ **`localStorage` is a CACHE and `user_settings` is the state — that
 * direction is the whole point, and an EMPTY cache is the only thing that can
 * prove it.** Playwright gives each test a fresh context, but that alone is not
 * enough and assuming it was nearly cost this file its second test: visiting
 * `/settings` inside the same test WARMS `gantt:theme`, so a later `/app` in
 * that context reads the right theme out of the cache whether or not the row is
 * ever consulted. MEASURED — with the seed mutated back to the old
 * DOM-attribute form, that test passed anyway. It now clears the key
 * explicitly, which is what makes the assertion about SQLite. The pre-paint
 * bootstrap in `app/layout.tsx` still reads the cache first, because a cache
 * hit is the only way to be right BEFORE the first paint; the row is what makes
 * it right at all.
 *
 * MUTATION TEST — applied to the source, rebuilt with `npm run app:build`, run,
 * reverted:
 *  1. remove `<Personalization>` from `board-home-screen.tsx` → **"the picker
 *     draws the stored accent colour"** red, `--accent` resolving to the stock
 *     blue.
 *  2. seed `ThemeToggle` from `document.documentElement.dataset.theme` again
 *     instead of from `initial` → **"the picker opens in the stored theme with
 *     an empty cache"** red, `data-theme` coming back `undefined` against
 *     `light` on disk. ⚠️ This mutation is also what exposed the cache warming
 *     above; the FIRST version of that test survived it.
 *  3. drop the `updateSettings` call from `ThemeToggle`'s `toggle` → **"a theme
 *     chosen on the picker survives a reload"** red on the wait for the write,
 *     because no Server Action is issued at all. ⚠️ Note where it does NOT red:
 *     the reload assertion straight after would have PASSED, because this
 *     context's `localStorage` was warmed by the click and the pre-paint
 *     bootstrap reads it. The `/settings` assertion at the end is the one that
 *     can only be satisfied by the row.
 */
test.describe.configure({ mode: "serial" });

/** The Teal preset, verbatim from `ACCENT_PRESETS`. */
const TEAL = "#14b8a6";

/** The `--accent` custom property as the browser resolves it on `<html>`. */
async function accentVar(page: Page): Promise<string> {
  return (
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--accent")
        .trim(),
    )
  ).toLowerCase();
}

/** The theme actually in force on `<html>`. */
async function domTheme(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.theme);
}

/** Put the shipped default back so later specs run on a dark board. */
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto("/settings");
    const dark = page
      .locator('[data-setting-row="Theme"]')
      .getByRole("button", { name: "Dark", exact: true });
    await expect(dark).toBeVisible();
    // ⚠️ Idempotent: the form skips a no-op delta entirely, so clicking the
    // value that is already stored produces no "Saved" ping and an
    // unconditional wait for one would time out. Same reasoning as
    // `ui-chip-mode.spec.ts`'s restore hook.
    if ((await dark.getAttribute("aria-pressed")) !== "true") {
      await dark.click();
      await expect(page.getByText("Saved")).toBeVisible();
    }
  } finally {
    await page.close();
  }
});

test.describe("the board picker", () => {
  test("draws the stored accent colour", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Accent color")).toBeVisible();
    // Positive control: the value this test is about to set is not already
    // there, so the assertion below cannot be satisfied by a page that never
    // changed.
    await expect(page.getByTitle("Custom color")).not.toHaveValue(TEAL);
    await page.getByTitle("Teal").click();
    await expect(page.getByText("Saved")).toBeVisible();

    // Settings itself honours it — the control surface, and the proof that the
    // value reached `<html>` at all rather than only the input.
    //
    // ⚠️ `expect.poll`, not a bare `expect(await …)`. `--accent` is written by
    // `<Personalization>`'s effect, which runs after hydration, and a
    // one-shot read races it: MEASURED under an 8× CPU throttle, the bare form
    // returned the stock `#3b82f6` and red-ed a working application. Polling is
    // what makes this an assertion about the value rather than about how busy
    // the machine was.
    await expect.poll(() => accentVar(page)).toBe(TEAL);

    await page.goto("/app");
    await expect(boardCard(page, "My Board")).toBeVisible();
    // ⚠️ The picker, in a context whose `localStorage` was never written.
    await expect.poll(() => accentVar(page)).toBe(TEAL);
  });

  test("opens in the stored theme with an empty cache", async ({ page }) => {
    await page.goto("/settings");
    const light = page
      .locator('[data-setting-row="Theme"]')
      .getByRole("button", { name: "Light", exact: true });
    // Positive control on the setup: the stored value is NOT already light, so
    // the picker assertion below is about a value that actually moved.
    await expect(light).toHaveAttribute("aria-pressed", "false");
    await light.click();
    await expect(page.getByText("Saved")).toBeVisible();

    // ⚠️ **Empty the cache before asking.** The Settings page just wrote
    // `gantt:theme` in this very context, so without this line the pre-paint
    // bootstrap answers from the cache and the picker is right for a reason
    // that has nothing to do with the row. MEASURED: with the old
    // `dataset.theme` seed restored, this test passed until this line existed.
    await page.evaluate(() => localStorage.removeItem("gantt:theme"));

    await page.goto("/app");
    await expect(boardCard(page, "My Board")).toBeVisible();
    // The bootstrap therefore found nothing, and only the row can have
    // produced this. Polled for the same reason as the accent above: this is a
    // value a post-hydration effect writes.
    await expect.poll(() => domTheme(page)).toBe("light");
    // …and the cache is now warm, which is what makes the NEXT first paint
    // right before any JavaScript of ours runs.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("gantt:theme")))
      .toBe("light");
  });

  test("a theme chosen on the picker survives a reload", async ({ page }) => {
    await page.goto("/app");
    await expect(boardCard(page, "My Board")).toBeVisible();
    // The previous test left `light` on disk.
    await expect.poll(() => domTheme(page)).toBe("light");

    // ⚠️ `withWrite`, not a bare `page.waitForResponse`. Every Server Action in
    // this app posts to the same URL, so a waiter registered around the click
    // also matches anything already in flight — the exact confusion `withWrite`
    // exists to remove, by recording requests at DISPATCH and accepting only a
    // response belonging to one of them. It is also bounded at 5 s, so "no
    // write was issued" reds quickly instead of expiring the whole test.
    await withWrite(page, () =>
      page.getByTitle("Switch to dark theme").click(),
    );
    await expect.poll(() => domTheme(page)).toBe("dark");

    await page.reload();
    await expect(boardCard(page, "My Board")).toBeVisible();
    await expect.poll(() => domTheme(page)).toBe("dark");
    // …and the row, not just this window: Settings reads it back from SQLite
    // on the server, so a value that only reached `localStorage` fails here.
    await page.goto("/settings");
    await expect(
      settingControl(page, "Theme").filter({ hasText: "Dark" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
