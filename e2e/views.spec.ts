import { expect, test } from "@playwright/test";
import { GANTT_GRID, boardCard, openBoard, switchView } from "./helpers";

/**
 * Every view opens, draws itself properly, and offers nothing to buy.
 *
 * ⚠️ **This is the observable form of "there are no account tiers".** The
 * source-level greps prove no symbol survives; this proves no *pixel* does —
 * no padlock on Week or Day, no overlay over a view, no chip in search, and
 * none of the vocabulary a tiered product uses. Every account is the same
 * account because there are no accounts, and a user should never encounter a
 * surface implying otherwise.
 *
 * ⚠️ One test here is not about that at all: **"the first hour label in Week is
 * not sliced by the scroll edge"** is a GEOMETRY assertion, and it lives with
 * the other view tests because the thing it guards is Week/Day opening
 * correctly. A layout defect that no text assertion can see needs a measured
 * one, and this suite is the only layer that can take the measurement.
 */

const FORBIDDEN =
  /upgrade|pro plan|\bpro\b|paywall|subscription|billing|sign out|share|collaborat|google calendar/i;

test.describe("every view is open", () => {
  test("Gantt, Week and Day all open with no lock", async ({ page }) => {
    await openBoard(page);

    // ⚠️ Each view gets a positive control that IT rendered, not merely that a
    // page exists: `toHaveCount(0)` passes on a blank screen, so an absence
    // assertion is only meaningful once something is known to be present.
    // Both markers are one-per-page — MEASURED: `[data-cal-strip]` is 1 in
    // Week and Day and 0 in Gantt, `[data-gantt-header]` the other way round —
    // so each also proves the OTHER view is gone rather than layered under it.
    const marker = {
      Week: "[data-cal-strip]",
      Day: "[data-cal-strip]",
      Gantt: GANTT_GRID,
    } as const;

    for (const view of ["Week", "Day", "Gantt"] as const) {
      await switchView(page, view);
      await expect(page.locator(marker[view])).toBeVisible();
      // No padlock glyph, no locked overlay, no vocabulary of a tiered product.
      await expect(page.getByText("🔒")).toHaveCount(0);
      await expect(page.getByText(FORBIDDEN)).toHaveCount(0);
    }
  });

  test("search opens with no plan chip", async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press("ControlOrMeta+k");
    // Positive control: the palette is open, so the absence assertion below is
    // being made against a rendered dialog rather than against nothing.
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
    await expect(page.getByText(FORBIDDEN)).toHaveCount(0);
  });

  test("the first hour label in Week is not sliced by the scroll edge", async ({
    page,
  }) => {
    // ⚠️ **A geometry assertion, because the defect was geometry.** The gutter
    // draws every hour label but the first at `-top-1.5`, straddling the line
    // it names, and Week/Day open by scrolling to ~8AM — so the hour parked at
    // the top of the viewport had its upper half ABOVE that viewport and was
    // sliced in half by the pinned ALL DAY strip. MEASURED before the fix, in
    // this exact spot: the first visible label's `top` was **5.4px above** the
    // scroller's own top edge; after it, 2.6px BELOW. The `i === 0` special
    // case in the gutter only ever protected the unscrolled case.
    //
    // Nothing throws when this regresses and no text assertion can see it,
    // which is why it is measured rather than looked at.
    await openBoard(page);
    await switchView(page, "Week");
    await expect(page.locator("[data-cal-strip]")).toBeVisible();

    const geom = await page.evaluate(() => {
      // The vertical scroll body of the calendar. Identified by the two
      // properties that define it rather than by a class name that happens to
      // be on it: it scrolls vertically and it contains the hour gutter.
      const scroller = [...document.querySelectorAll<HTMLElement>("div")].find(
        (el) =>
          getComputedStyle(el).overflowY === "auto" &&
          el.scrollHeight > el.clientHeight &&
          // ⚠️ No `\b` anchors. The gutter's labels concatenate with no
          // separator — MEASURED, `textContent` reads `6 AM7 AM8 AM…` — so a
          // digit is preceded by `M`, both word characters, and the boundary
          // never matches. The first form of this predicate was false on the
          // real element and the positive control below is what caught it.
          /\d{1,2}\s(AM|PM)/.test(el.textContent ?? ""),
      );
      if (!scroller) return null;
      const top = scroller.getBoundingClientRect().top;
      const labels = [...scroller.querySelectorAll<HTMLElement>("span")]
        .filter((el) => /^\d{1,2}\s(AM|PM)$/.test(el.textContent?.trim() ?? ""))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            text: el.textContent?.trim() ?? "",
            top: r.top,
            bottom: r.bottom,
          };
        });
      const visible = labels.filter((l) => l.bottom > top && l.top < top + 40);
      return {
        scrollTop: scroller.scrollTop,
        labelCount: labels.length,
        firstVisible: visible[0] ?? null,
        overhangPx: visible[0] ? top - visible[0].top : null,
      };
    });

    // Positive controls on the measurement itself. An empty gutter, a
    // scroller that was never found, or a view that never scrolled would all
    // make the assertion below vacuous.
    expect(geom).not.toBeNull();
    expect(geom!.labelCount).toBeGreaterThan(6);
    expect(geom!.scrollTop).toBeGreaterThan(0);
    expect(geom!.firstVisible).not.toBeNull();

    // ⚠️ The assertion: no part of that label is above the scroll viewport.
    expect(geom!.overhangPx).toBeLessThanOrEqual(0);
  });

  test("the board picker and Settings carry no plan vocabulary", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(boardCard(page, "My Board")).toBeVisible();
    await expect(page.getByText(FORBIDDEN)).toHaveCount(0);

    await page.goto("/settings");
    await expect(page.getByText("Accent color")).toBeVisible();
    await expect(page.getByText(FORBIDDEN)).toHaveCount(0);
  });
});
