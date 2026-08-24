import { expect, test } from "@playwright/test";
import { GANTT_GRID } from "./helpers";

/**
 * The five routes, and the two ways of arriving at a board that do not exist.
 *
 * There are exactly five: `/`, `/app/[[...slug]]`, `/settings`, `/api/health`
 * and the not-found page. `/api/health` is not decoration — `electron/main.ts`
 * polls it every 100 ms for up to 30 s before it opens a window, so a route
 * that stops returning 200 is a desktop app that never starts.
 */
test.describe("routes", () => {
  test("/api/health answers 200 and a bogus route answers 404", async ({
    request,
  }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);

    // ⚠️ The positive control for every "it 404s" claim in this suite: if the
    // server answered 200 to everything, the assertion above would be
    // meaningless. These two must disagree.
    const bogus = await request.get("/__no_such_route__");
    expect(bogus.status()).toBe(404);
  });

  test("/ lands on the board picker", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/app$/);
  });

  test("a stale board id falls back to the picker", async ({ page }) => {
    // ⚠️ Assert on the FINAL URL, never on a response status. `loading.tsx`
    // streams the shell first, so the redirect for an unknown board arrives in
    // the flight payload and runs client-side: MEASURED, the document response
    // is HTTP 200 and only the URL afterwards tells the truth.
    await page.goto("/app/00000000-0000-4000-8000-000000000000/gantt");
    await expect(page).toHaveURL(/\/app$/);
    // And it is the picker, not an error boundary.
    await expect(page.getByText("Quick access")).toBeVisible();
  });

  test("a bogus path under /app renders the board, not a crash", async ({
    page,
  }) => {
    // `/app/<id>` with no view keyword is a legitimate slug — the parser takes
    // the id first, then the view keyword — so this must open the board rather
    // than 404.
    await page.goto("/app");
    const href = await page
      .locator('a[href*="/gantt"]')
      .first()
      .getAttribute("href");
    expect(href).not.toBeNull();
    await page.goto(href!.replace(/\/gantt$/, ""));
    await expect(page.locator(GANTT_GRID)).toBeVisible();
  });
});
