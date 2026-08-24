import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { DB_FILE } from "./env";
import { GANTT_GRID, boardCard } from "./helpers";

/**
 * The bootstrap, end to end: filesystem, server and renderer together.
 *
 * `e2e/serve.mjs` deletes the data directory before starting the server, so
 * this run genuinely begins with nothing on disk. The database is created by
 * `instrumentation.ts` as the server boots — which for a desktop app IS "the
 * user launched it" — so by the time this spec runs the file exists and the
 * seed has landed. That is the behaviour under test: a person who has never
 * run Weekloom before opens it and is looking at a board, with no account, no
 * sign-in and no redirect chain in between.
 *
 * ⚠️ Playwright orders spec FILES alphabetically, so `archive` and `board-crud`
 * have already run against this database by the time this one does. That is
 * fine and is stated rather than papered over: what makes the run a first run
 * is `e2e/serve.mjs` emptying the directory before the server starts, and
 * neither of those specs touches the seeded board, its two lanes, or the
 * absence of a sign-in surface. Nothing here asserts an empty database.
 */
test.describe("first run", () => {
  test("creates the local database and lands straight on the board list", async ({
    page,
  }) => {
    const responses: number[] = [];
    page.on("response", (r) => {
      if (new URL(r.url()).pathname === "/app") responses.push(r.status());
    });

    await page.goto("/app");

    // No login, no landing page, no redirect: the URL we asked for is the URL
    // we are on.
    expect(new URL(page.url()).pathname).toBe("/app");
    // ⚠️ The length check first. `[].every(...)` is `true`, so without it a
    // listener that never fired would report a clean 200 forever.
    expect(responses.length).toBeGreaterThan(0);
    expect(responses.every((s) => s === 200)).toBe(true);

    await expect(boardCard(page, "My Board")).toBeVisible();

    // The database is a plain file in the throwaway data directory.
    expect(existsSync(DB_FILE)).toBe(true);
  });

  test("the seeded board has a General lane and a Completed lane", async ({
    page,
  }) => {
    await page.goto("/app");
    await boardCard(page, "My Board").click();
    await expect(page.locator(GANTT_GRID)).toBeVisible();

    await expect(
      page.getByText("General", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Completed", { exact: true }).first(),
    ).toBeVisible();
  });

  test("nothing on the way in asks who you are", async ({ page }) => {
    await page.goto("/app");
    // Positive control for the negative assertion below: this text IS on the
    // page, so a matcher that found nothing at all would fail here first.
    await expect(page.getByText(/board/i).first()).toBeVisible();

    await expect(
      page.getByText(/sign in|sign up|log in|create an account|sign out/i),
    ).toHaveCount(0);
  });
});
