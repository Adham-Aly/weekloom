import { expect, test } from "@playwright/test";
import { boardCard } from "./helpers";

/**
 * Archive and restore, for a board.
 *
 * ⚠️ **The Trash is the only consumer of archived rows**, which is exactly why
 * this is worth an end-to-end spec: a data layer that filtered `archived = 1`
 * out of every read would look completely correct on the board list, on the
 * board itself and in every other spec here — and would quietly make archiving
 * an irreversible delete. The only way to see it is to archive something and
 * then go looking for it.
 */
test.describe.configure({ mode: "serial" });

const BOARD = "E2E Archive Board";

/**
 * ⚠️ The header's Trash button is reached by `title`, not by accessible name:
 * it renders its count as text, and text content beats `title` when the
 * accessible name is computed. MEASURED: with one board in the trash the button
 * is `title="Trash (1)"` with text `"1"`, so
 * `getByRole("button", { name: /trash/i })` resolves to **0** elements and the
 * previous form of this spec timed out against a button that was on screen.
 */
const trashButton = "Trash";

test.describe("archiving a board", () => {
  test("a new board can be archived and found in the Trash", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "New board", exact: true }).click();
    const input = page.getByPlaceholder("Untitled Board");
    await input.fill(BOARD);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    // ⚠️ Creating a board NAVIGATES into it — MEASURED: the URL after Create is
    // `/app/<new id>/gantt`, not `/app`. So the picker has to be reopened
    // before the board can be found in it; asserting on the name without doing
    // that would have been satisfied by the new board's own title bar.
    await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}\/gantt$/);
    await page.goto("/app");
    await expect(boardCard(page, BOARD)).toBeVisible();

    await boardCard(page, BOARD).click({ button: "right" });
    await page.getByRole("button", { name: "Move to trash" }).click();

    // Gone from the active list…
    await expect(
      page.getByRole("link", { name: new RegExp(BOARD) }),
    ).toHaveCount(0);

    // …and present in the Trash, which is the assertion that matters.
    await page.getByTitle(new RegExp(`^${trashButton}`)).click();
    await expect(page.getByText(BOARD, { exact: true })).toBeVisible();
  });

  test("restoring it returns it to the active list, across a reload", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.getByTitle(new RegExp(`^${trashButton}`)).click();
    // Positive control: the archived board is where the previous test left it,
    // i.e. it survived a full page load out of SQLite rather than living in the
    // React state the first test happened to leave behind.
    await expect(page.getByText(BOARD, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Restore" }).click();

    await page.reload();
    await expect(boardCard(page, BOARD)).toBeVisible();
  });
});
