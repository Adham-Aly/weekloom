import { expect, test, type Page } from "@playwright/test";
import { openBoard, switchView, visibleCalDay } from "./helpers";

/**
 * A recurring series, end to end.
 *
 * ⚠️ **What only this can prove.** `origin_day_offset` is the series dedup key,
 * never position. If materialisation ever dedups on `day_offset` — or if the
 * origin is left NULL on a sparse insert — the watermark reads as -1, every
 * offset is proposed, the insert predicate is vacuously true, and the series
 * gains one duplicate stacked on every occurrence, on every launch, with
 * nothing erroring. The unit tests pin the arithmetic; only this pins the
 * arithmetic actually running in the shipped app.
 *
 * A series is created from the calendar's drag-to-create popover, which is
 * where the weekday picker lives.
 */
test.describe.configure({ mode: "serial" });

const TITLE = "E2E Standup";

async function openWeekView(page: Page) {
  await openBoard(page);
  await switchView(page, "Week");
  await expect(page.locator("[data-cal-strip]")).toBeVisible();
}

/** Every card of the series that is currently laid out anywhere in the strip. */
function seriesCards(page: Page) {
  return page.locator("[data-cal-card]").filter({ hasText: TITLE });
}

test.describe("recurring series", () => {
  test("creating one lays down occurrences weeks out", async ({ page }) => {
    await openWeekView(page);

    // ⚠️ An ON-SCREEN day column. The strip holds five weeks side by side for
    // panning (MEASURED: 35 `[data-cal-day]` nodes, 7 of them inside the pan
    // window), so `.nth(2)` addresses a column two weeks in the past and the
    // drag would create the series on a date the later assertions never look
    // at.
    const day = await visibleCalDay(page, 2);
    const box = await day.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height * 0.3;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 40, { steps: 4 });
    await page.mouse.up();

    const title = page.getByPlaceholder("New task");
    await expect(title).toBeVisible();
    await title.fill(TITLE);

    // The label wraps an `sr-only` checkbox, so clicking the text IS the user
    // gesture; the checkbox state is then the positive control that it landed.
    await page.getByText("Recurring task").click();
    await expect(page.getByRole("checkbox")).toBeChecked();

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(seriesCards(page).first()).toBeVisible();
  });

  test("a reload does not duplicate a single occurrence", async ({ page }) => {
    await openWeekView(page);
    const before = await seriesCards(page).count();
    // Positive control: if the series never landed, the assertion below would
    // pass trivially with 0 === 0.
    expect(before).toBeGreaterThan(0);

    await page.reload();
    await expect(page.locator("[data-cal-strip]")).toBeVisible();
    await expect(seriesCards(page).first()).toBeVisible();

    expect(await seriesCards(page).count()).toBe(before);
  });

  test("the series reaches roughly eight weeks out", async ({ page }) => {
    await openWeekView(page);
    // Six weeks forward is well inside the 56-day materialisation window and
    // well outside anything a single-week render could have produced.
    // ⚠️ `getByTitle`, not `getByRole(name:)`: the pager is an icon button, and
    // its neighbour "Next month" would also match a loose /next/ name regex.
    for (let i = 0; i < 6; i += 1) {
      await page.getByTitle(/^Next week/).click();
      await page.waitForTimeout(400);
    }
    await expect(seriesCards(page).first()).toBeVisible();
  });
});
