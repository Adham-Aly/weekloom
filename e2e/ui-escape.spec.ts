import { expect, test } from "@playwright/test";
import { blockSection, createBlock, createItem, openBoard } from "./helpers";

/**
 * Escape reaches the board, and a nested dismissable closes only itself.
 *
 * ⚠️ **Why this file exists.** `lib/hooks/use-escape.ts` keeps ONE shared LIFO
 * stack behind ONE capture-phase window listener, and that listener calls
 * `stopPropagation()` whenever the stack is non-empty — deliberately, so the
 * board's own bubble-phase keydown does not also fire while a modal is open.
 * The consequence is that a dismissable which registers while CLOSED swallows
 * Escape for everything underneath it, silently: nothing throws, nothing logs,
 * and the key simply stops working.
 *
 * Three always-mounted controls did exactly that — the view switcher in the
 * board toolbar, the unscheduled tray's date picker in Week/Day, and the block
 * dropdown inside every modal and popover that has one. MEASURED before they
 * were gated on `open`: a capture-phase probe on `document` recorded no keydown
 * at all reaching the board, so a cell selection could not be cleared, the
 * marching-ants copy outline could not be dismissed, and day-focus could not be
 * exited. They now pass `enabled` — the hook's own documented second argument.
 *
 * ⚠️ **Both directions, and both are needed.** Test one proves Escape now
 * REACHES the board; test two proves the modals it used to swallow for are
 * still dismissed, and in the right order — the dropdown first, its modal
 * second. A fix that unregistered too much would pass the first and fail the
 * second.
 *
 * MUTATION TEST — applied to the source, rebuilt with `npm run app:build`, run,
 * reverted:
 *  1. drop the `open` argument from `ViewMenu`'s `useEscape` in `board.tsx`
 *     → **"Escape clears the copy outline on the board"** red, the outline
 *     still present after the key.
 *  2. drop the `open` argument from `BlockSelect`'s `useEscape`
 *     → **"Escape closes an open block dropdown, not the modal under it"** red:
 *     the modal closes on the first Escape while the dropdown is still open.
 */
test.describe.configure({ mode: "serial" });

const LANE = "E2E Escape Lane";
const TASK = "E2E Escape Task";

test.describe("Escape", () => {
  test("Escape clears the copy outline on the board", async ({ page }) => {
    await openBoard(page);
    await createBlock(page, LANE);
    await createItem(page, TASK, LANE);

    /**
     * ⚠️ A MODIFIER click on the step row's sidebar is the gesture that
     * selects a cell, and the modifier is not decoration. `step-row.tsx`'s
     * `onMouseDownCapture` treats a PLAIN click as "put the caret in this
     * row's label" and clears the painted selection on purpose; only
     * Shift / ⌘ / Ctrl takes the click over and selects. MEASURED while
     * writing this: a plain click left `getComputedStyle(...).outline` at
     * `none`, so the ⌘C below had no cells selection to copy and the whole
     * test would have asserted nothing.
     */
    const sidebar = blockSection(page, LANE)
      .locator("[data-item-row]")
      .filter({ hasText: TASK })
      .locator("[data-step-sidebar]")
      .first();
    await sidebar.click({ modifiers: ["ControlOrMeta"] });

    // ⌘C stamps the marching-ants set, which is the one piece of this state
    // the DOM query protocol exposes directly. `data-step-copied` is set by
    // `step-row.tsx` on the sidebar cell of every copied row.
    const copied = page.locator("[data-step-copied]");
    await page.keyboard.press("ControlOrMeta+c");
    // Positive control: the outline is there to be dismissed, so the
    // assertion below cannot pass against a board where nothing happened.
    // ⚠️ `navigator.clipboard.writeText` is DENIED in a headless context and
    // its rejection surfaces as a page error; the app voids that promise and
    // stamps the outline regardless, which is why this still works here.
    await expect(copied).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(copied).toHaveCount(0);
  });

  test("Escape closes an open block dropdown, not the modal under it", async ({
    page,
  }) => {
    await openBoard(page);
    await page.getByTitle("New item (C)").click();
    const title = page.getByPlaceholder("e.g. Study for Math Exam");
    await expect(title).toBeVisible();

    // The lane the modal is currently offering. Its name appears once as the
    // field's own button; opening the dropdown adds a second occurrence as a
    // menu row.
    //
    // ⚠️ **Counted as a DELTA, never as an absolute.** The same lane also
    // renders a header button with the same accessible name on the board
    // behind the modal, so the absolute number depends on how many lanes this
    // spec's predecessors left behind. The delta does not.
    const blockField = page
      .locator("div")
      .filter({ has: page.getByText("Block", { exact: true }) })
      .last();
    const fieldButton = blockField.getByRole("button");
    const laneName = ((await fieldButton.innerText()) ?? "").trim();
    expect(laneName.length).toBeGreaterThan(0);
    const named = page.getByRole("button", { name: laneName, exact: true });
    const closedCount = await named.count();

    await fieldButton.click();
    // Positive control: the dropdown really opened.
    await expect(named).toHaveCount(closedCount + 1);

    await page.keyboard.press("Escape");
    // ⚠️ The dropdown closed…
    await expect(named).toHaveCount(closedCount);
    // …and the modal did NOT. Before the fix the dropdown's stack entry was
    // pinned BELOW its own modal's — effects run child-first and the entry's
    // position is fixed at registration — so this key dismissed the whole
    // modal and threw away whatever had been typed into it.
    await expect(title).toBeVisible();

    // A second Escape unwinds the next level, which is the behaviour the
    // shared stack exists to provide.
    await page.keyboard.press("Escape");
    await expect(title).toBeHidden();
  });
});
