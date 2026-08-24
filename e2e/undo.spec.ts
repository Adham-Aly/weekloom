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
 * Undo, all the way back to disk.
 *
 * ⚠️ **Undo writes UNGUARDED, and must.** It restores a snapshot over current
 * state by definition, so any version or expectation check would reject every
 * undo there has ever been. What this spec proves that no unit test can: the
 * diff replays through the real Server Actions in FK-safe order against the
 * real schema — blocks before items before steps — so a restored block still
 * has its tasks and their days rather than an empty lane.
 */
test.describe.configure({ mode: "serial" });

const LANE = "E2E Undo Lane";
const TASK = "E2E Undo Task";

test.describe("undo", () => {
  test("undoing a lane delete brings back its tasks and steps", async ({
    page,
  }) => {
    await openBoard(page);
    await createBlock(page, LANE);
    // ⚠️ In the lane, not in the toolbar's default lane — otherwise deleting
    // the lane never takes the task with it and the restore proves nothing.
    await createItem(page, TASK, LANE);
    await reloadBoard(page);

    const stepsBefore = await page.locator("[data-cell-step-id]").count();
    // Positive control: there is something to lose.
    expect(stepsBefore).toBeGreaterThan(0);

    await openBlockMenu(page, LANE);
    await page.getByRole("button", { name: "Delete block" }).click();
    // `exact`: the confirm dialog's button is the only exact "Delete" once the
    // menu has closed, so this needs no guess about DOM order.
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(blockSection(page, LANE)).toHaveCount(0);

    // ⚠️ Wait for the replay to reach the server before reloading. Undo restores
    // a whole subtree — the block, then its items, then their steps — as a
    // SEQUENCE of Server Actions inside `startTransition`, and the optimistic
    // React state is on screen before any of them has gone out. MEASURED: a
    // reload issued the instant the restored lane appears cancels the rest of
    // the sequence, and the board comes back with the lane present and EMPTY.
    // That is a race in this spec, not a lost write: with the replay allowed to
    // finish, the lane, its task and all of its steps survive the reload every
    // time.
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page.keyboard.press("ControlOrMeta+z"),
    ]);
    await page.waitForLoadState("networkidle");

    await expect(blockSection(page, LANE)).toHaveCount(1);
    await expect(itemBar(page, TASK)).toBeVisible();

    // ⚠️ And it is on disk, not merely back in React state.
    await reloadBoard(page);
    await expect(blockSection(page, LANE)).toHaveCount(1);
    await expect(itemBar(page, TASK)).toBeVisible();
    expect(await page.locator("[data-cell-step-id]").count()).toBe(stepsBefore);
  });
});
