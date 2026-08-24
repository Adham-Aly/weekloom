import { expect, test } from "@playwright/test";
import { boardCard, openBoard, switchView } from "./helpers";

/**
 * ⚠️ **The product's central claim, and the only place it is checkable.**
 *
 * "Your data never leaves your computer" is not a design intention here, it is
 * the reason the project exists. Three things enforce it: `next/font` self-hosts
 * every face at build time, the CSP's `connect-src 'self'` blocks a runtime
 * fetch, and `tests/no-cloud-imports.test.ts` refuses a cloud SDK or a
 * third-party hostname in source. None of the three observes the running
 * browser. This does.
 *
 * A request listener that never fires produces an empty list, which is
 * indistinguishable from a clean result — so the second test is a positive
 * control that the same listener DOES record the loopback traffic. Read an
 * empty external list as meaningful only if that control passed.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

test.describe("nothing leaves the machine", () => {
  test("a full walk of the app issues no request off 127.0.0.1", async ({
    page,
  }) => {
    const external: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      // data: and blob: URLs have no host and never touch a network.
      if (url.protocol === "data:" || url.protocol === "blob:") return;
      if (!LOOPBACK.has(url.hostname)) external.push(req.url());
    });

    await openBoard(page);

    for (const view of ["Week", "Day", "Gantt"] as const) {
      await switchView(page, view);
    }

    await page.goto("/settings");
    await expect(page.getByText("Accent color")).toBeVisible();

    await page.goto("/app");
    await expect(boardCard(page, "My Board")).toBeVisible();

    expect(external).toEqual([]);
  });

  test("the listener records loopback traffic — positive control", async ({
    page,
  }) => {
    const seen: string[] = [];
    page.on("request", (req) => seen.push(req.url()));

    await openBoard(page);

    // A board page pulls its document, its RSC payload, its chunks and its
    // stylesheets. If this is small, the listener is not attached and the
    // assertion above proved nothing.
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.every((u) => u.startsWith("http://127.0.0.1:"))).toBe(true);
  });
});
