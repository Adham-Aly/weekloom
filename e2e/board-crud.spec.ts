import { expect, test } from "@playwright/test";
import {
  blockSection,
  createBlock,
  createItem,
  itemBar,
  openBlockMenu,
  openBoard,
  reloadBoard,
} from "./helpers";

/**
 * The core write path: optimistic `setState` → `persist()` → Server Action →
 * SQLite.
 *
 * ⚠️ **Every assertion here is made after a RELOAD, deliberately.** Reading the
 * DOM straight after a click proves only that React state changed — which it
 * does whether or not the write ever reached the database. A board whose
 * persistence has been broken looks perfect until somebody restarts the app,
 * and this is the only automated check in the project that can tell those two
 * apart.
 *
 * The three tests run in order against one database (`workers: 1`,
 * `fullyParallel: false`): the first creates, the second edits, the third
 * deletes. That is the flow a person performs, and splitting it into three
 * independent fixtures would test the setup rather than the product.
 */
test.describe.configure({ mode: "serial" });

const LANE = "E2E Lane";
const TASK = "E2E Task";

/** The lane's own section, addressed through the DOM query protocol. */
const laneSection = (page: import("@playwright/test").Page) =>
  blockSection(page, LANE);

test.describe("board CRUD survives a reload", () => {
  test("a lane and a task persist", async ({ page }) => {
    await openBoard(page);
    await createBlock(page, LANE);
    // ⚠️ Created IN the lane, not in whatever the toolbar defaults to — the
    // third test's cascade assertion is meaningless otherwise.
    await createItem(page, TASK, LANE);

    await reloadBoard(page);
    await expect(laneSection(page)).toHaveCount(1);
    await expect(itemBar(page, TASK)).toBeVisible();
  });

  test("marking a step done persists, and un-marking it puts it back", async ({
    page,
  }) => {
    await openBoard(page);
    const step = page.locator("[data-cell-step-id]").first();
    await expect(step).toBeVisible();
    const stepId = await step.getAttribute("data-cell-step-id");
    expect(stepId).not.toBeNull();
    const stepCell = page.locator(`[data-cell-step-id="${stepId}"]`);

    // The toggle is revealed on hover; Playwright hovers as part of the click.
    await page.getByRole("button", { name: "Mark done" }).first().click();

    await reloadBoard(page);
    // ⚠️ The task has exactly one step, so completing it retires the whole item
    // into the `Completed` system lane — MEASURED: its bar and its step cell
    // both leave the grid and a "Mark not done" row appears in Completed. The
    // step id disappearing is therefore the CORRECT observation, not a lost
    // write, and asserting `toHaveCount(1)` on it (as this spec first did) fails
    // on a perfectly working app.
    await expect(stepCell).toHaveCount(0);
    await expect(itemBar(page, TASK)).toHaveCount(0);
    const restore = page.getByRole("button", { name: "Mark not done" });
    await expect(restore).toBeVisible();

    // ⚠️ The round trip is what proves the write reached SQLite rather than
    // React: un-mark it, reload again, and the SAME step id is back in the
    // lane. A state that only ever moved one way could be an optimistic render
    // that never persisted.
    await restore.click();
    await reloadBoard(page);
    await expect(stepCell).toHaveCount(1);
    await expect(itemBar(page, TASK)).toBeVisible();
  });

  test("deleting a lane removes its task too, and it stays deleted", async ({
    page,
  }) => {
    await openBoard(page);
    // Positive control for the two absence assertions below: both things this
    // test is about to delete are on screen right now.
    await expect(laneSection(page)).toHaveCount(1);
    await expect(itemBar(page, TASK)).toBeVisible();

    await openBlockMenu(page, LANE);
    await page.getByRole("button", { name: "Delete block" }).click();
    // ⚠️ `exact` matters twice over: it excludes the "Delete block" menu item
    // (which by then has closed anyway) and it excludes the Trash view's
    // "Delete forever". The confirm dialog's button is the only exact "Delete"
    // on the page, so this needs no `.first()`/`.last()` guess about DOM order.
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await reloadBoard(page);
    await expect(laneSection(page)).toHaveCount(0);
    await expect(itemBar(page, TASK)).toHaveCount(0);
  });
});
