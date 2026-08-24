import {
  expect,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

/**
 * Shared driving code for the end-to-end suite.
 *
 * ⚠️ **Query the `data-*` attributes, never a CSS class and never visible
 * text where an attribute exists.** `data-cell-step-id`, `data-cell-item-bar`,
 * `data-gantt-header`, `data-block-section`, `data-cal-day`, `data-cal-strip`
 * and `data-setting-row` are the DOM query protocol the app's own selection,
 * marquee and keyboard navigation already read. They are stable by
 * construction: renaming one breaks a gesture, so nobody renames one casually —
 * and if somebody does, these specs go red instead of a user silently losing a
 * feature.
 *
 * ⚠️ **Most of that protocol is deliberately NON-UNIQUE.** `data-gantt-sidebar`
 * is on every sticky-left cell (MEASURED: 4 of them on an empty board, more as
 * rows appear) because the pinned-header tracker has to find all of them. So it
 * can never be the subject of a bare `toBeVisible()` — that is a strict-mode
 * violation, not a check. The one-per-page marker for "the Gantt grid is on
 * screen" is `data-gantt-header`, which board.tsx renders exactly once
 * (MEASURED: count 1 in Gantt view, 0 in Week and Day view).
 *
 * Buttons that carry no attribute are reached by their `title` or accessible
 * name, which are the two things a screen reader also uses. ⚠️ **`title` is
 * only the accessible name when the button has NO text content**, so an icon
 * button that also renders a badge computes its name from the badge. MEASURED
 * on the board picker's Trash button, which has `title="Trash (1)"` and text
 * `"1"`: `getByRole("button", { name: /trash/i })` resolved to 0 elements
 * while a screen reader announced it as "1". That was a real accessibility
 * defect and the button now carries an explicit `aria-label` with an
 * `aria-hidden` badge, so both spellings work there today.
 *
 * The rule stands for every other badge-carrying icon button in this app, and
 * `getByTitle` is what these specs use: it depends on the attribute the markup
 * actually sets rather than on a computed name that a later badge can silently
 * take over.
 */

/** The single node that means "the Gantt grid rendered". */
export const GANTT_GRID = "[data-gantt-header]";

/**
 * The Quick-access grid on the board picker.
 *
 * ⚠️ The picker lists every board **twice** — once as a Quick-access card and
 * once as a Recent row — and both are `<a>` elements pointing at the same href,
 * so `getByRole("link", { name })` is ambiguous by construction and always will
 * be. Scoping is the fix; `.first()` would merely hide which of the two a
 * failure was about.
 *
 * The grid is identified structurally, not by a Tailwind class: it is the
 * innermost element that contains the hollow "Add board" tile, which only the
 * Quick-access grid renders.
 */
export function quickAccess(page: Page): Locator {
  return page
    .locator("div")
    .filter({ has: page.getByRole("button", { name: "Add board" }) })
    .last();
}

/** A board's card in the Quick-access grid. Exactly one element. */
export function boardCard(page: Page, name: string): Locator {
  return quickAccess(page).getByRole("link", { name: new RegExp(name) });
}

/** Open the board picker and wait for the seeded board to be listed. */
export async function gotoBoards(page: Page): Promise<void> {
  await page.goto("/app");
  await expect(boardCard(page, "My Board")).toBeVisible();
}

/** Open a board and wait for the Gantt grid to render. */
export async function openBoard(page: Page, name = "My Board"): Promise<void> {
  await page.goto("/app");
  await boardCard(page, name).click();
  await expect(page.locator(GANTT_GRID)).toBeVisible();
}

/** Reload and wait for the board to be interactive again. */
export async function reloadBoard(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator(GANTT_GRID)).toBeVisible();
}

/** Create a lane. Returns once the lane's section is on screen. */
export async function createBlock(page: Page, name: string): Promise<void> {
  await page.getByTitle("New block").click();
  const input = page.getByPlaceholder("e.g. General School Tasks");
  await expect(input).toBeVisible();
  await input.fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(input).toBeHidden();
  await expect(
    page.locator("[data-block-section]").filter({ hasText: name }),
  ).toHaveCount(1);
}

/** A lane, addressed through the DOM query protocol. */
export function blockSection(page: Page, name: string): Locator {
  return page.locator("[data-block-section]").filter({ hasText: name });
}

/**
 * Open a lane's own context menu.
 *
 * ⚠️ Right-clicking the SECTION is not the same gesture. Playwright clicks the
 * centre of the target, and a lane that contains a task is tall enough that its
 * centre lands on the task's bar — which has a context menu of its own.
 * MEASURED: the previous form of this opened "Edit item / Delete item" and then
 * timed out waiting for "Delete block", on a board where the block menu was one
 * right-click away. The lane header is the only part of the section that is
 * unambiguously the lane.
 */
export async function openBlockMenu(page: Page, name: string): Promise<void> {
  await blockSection(page, name)
    .getByRole("button", { name, exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("button", { name: "Delete block" }),
  ).toBeVisible();
}

/**
 * Create a task, optionally in a named lane.
 *
 * ⚠️ The toolbar's create button is reached by `title="New item (C)"`, not by
 * its accessible name: every lane also renders a "New item" create row, so the
 * name is shared by three or more buttons and `.first()` would be a guess about
 * DOM order.
 *
 * ⚠️ **Passing `lane` is not a convenience, it is the only way to control which
 * lane the task lands in.** MEASURED: the toolbar modal defaults to the seeded
 * `General` lane and keeps defaulting to it after a new lane is created, so a
 * spec that creates a lane, creates a task from the toolbar and then deletes
 * the lane expecting the task to go with it is asserting nothing — the task was
 * never in that lane. The lane's own inline create row opens the same modal
 * with the lane pre-selected (MEASURED: the block picker reads back the lane's
 * name), and the resulting bar is a descendant of that lane's
 * `[data-block-section]`, which is what this asserts.
 */
export async function createItem(
  page: Page,
  title: string,
  lane?: string,
): Promise<void> {
  const opener =
    lane === undefined
      ? page.getByTitle("New item (C)")
      : blockSection(page, lane).getByTitle(
          "Click for modal, or drag across days →",
        );
  await opener.click();
  const input = page.getByPlaceholder("e.g. Study for Math Exam");
  await expect(input).toBeVisible();
  await input.fill(title);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(input).toBeHidden();
  const bar =
    lane === undefined
      ? itemBar(page, title)
      : blockSection(page, lane)
          .locator("[data-cell-item-bar]")
          .filter({ hasText: title });
  await expect(bar).toBeVisible();
}

/** The bar for a task, located through the item-bar attribute. */
export function itemBar(page: Page, title: string): Locator {
  return page.locator("[data-cell-item-bar]").filter({ hasText: title });
}

/**
 * Drag from the centre of `source` by a whole number of grid columns.
 *
 * ⚠️ Every drag in this app commits on RELEASE, never during — `mousemove`
 * touches client state only and `mouseup` makes the single server call. So the
 * intermediate move matters (some handlers only arm after the first move) and
 * the assertion belongs after the release, which is what these specs do.
 */
export async function dragBy(
  page: Page,
  source: Locator,
  dx: number,
  dy = 0,
): Promise<void> {
  const box = await source.boundingBox();
  if (box === null) throw new Error("drag source has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Two moves: the first arms the gesture, the second lands it. A single jump
  // is occasionally swallowed by a pointer-capture handler that expects motion.
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

/**
 * The pixel pitch of one Gantt column, measured from two adjacent day headers.
 *
 * ⚠️ NOT from `[data-nav-col]` — that attribute belongs to the keyboard
 * navigation grid and its values are `"label"` and `"effort"`, i.e. the step
 * row's sidebar cells, whose width has nothing to do with a day column.
 * MEASURED on an empty board: `[data-nav-col]` resolves to 0 elements, so a
 * width read from it would have thrown rather than lied — but on a board with
 * one task it resolves to 1, and that one is the label cell.
 *
 * `ColumnHeaderCell` (components/gantt/markers.tsx) renders one resize grip per
 * day column, absolutely positioned at the column's right edge, so the distance
 * between two consecutive grips IS the column pitch.
 */
export async function columnWidth(page: Page): Promise<number> {
  const grips = page.locator(
    `${GANTT_GRID} [title="Drag to resize all columns"]`,
  );
  await expect(grips.first()).toBeAttached();
  const count = await grips.count();
  if (count < 2) throw new Error(`only ${count} Gantt column(s) rendered`);
  const a = await grips.nth(0).boundingBox();
  const b = await grips.nth(1).boundingBox();
  if (a === null || b === null) throw new Error("column grips have no box");
  const pitch = b.x - a.x;
  if (!(pitch > 1)) throw new Error(`implausible column pitch ${pitch}`);
  return pitch;
}

/**
 * Switch the board view, asserting the route actually changed.
 *
 * ⚠️ The switcher button and the menu item for the same view share an
 * accessible name, so selecting the view you are ALREADY on would be a
 * strict-mode violation. That case is turned into an early return rather than
 * a `.first()`, which would have silently clicked the switcher instead of the
 * menu item.
 */
export async function switchView(
  page: Page,
  view: "Gantt" | "Week" | "Day",
): Promise<void> {
  const switcher = page.getByTitle("Switch view");
  await expect(switcher).toBeVisible();
  if ((await switcher.innerText()).trim() === view) return;
  await switcher.click();
  await page.getByRole("button", { name: view, exact: true }).click();
  await expect(switcher).toHaveText(view);
  await expect(page).toHaveURL(new RegExp(`/${view.toLowerCase()}(/|$)`));
}

/**
 * The indices of the `[data-cal-day]` columns currently inside the calendar's
 * pan window.
 *
 * ⚠️ The week view renders FIVE weeks side by side in one horizontally
 * scrollable strip — MEASURED: 35 `[data-cal-day]` columns, of which 7 are on
 * screen — because week panning is a native scroll gesture over a buffered
 * strip. So `.first()` and `.nth(2)` address a column two weeks in the past,
 * off screen, and a drag there lands on a different date than the one the
 * assertion later looks for.
 */
export async function visibleCalDays(page: Page): Promise<number[]> {
  await expect(page.locator("[data-cal-strip]")).toBeVisible();
  const indices = await page.evaluate(() => {
    const strip = document.querySelector("[data-cal-strip]");
    const win = strip?.parentElement?.getBoundingClientRect();
    if (win === undefined) return [];
    return [...document.querySelectorAll("[data-cal-day]")]
      .map((el, i) => ({ i, r: el.getBoundingClientRect() }))
      .filter(
        ({ r }) =>
          r.width > 0 && r.left >= win.left - 1 && r.right <= win.right + 1,
      )
      .map(({ i }) => i);
  });
  // A positive control on the measurement itself: a week is seven columns, and
  // an empty list would make every caller below silently address column 0.
  expect(indices.length).toBeGreaterThan(0);
  return indices;
}

/** One on-screen day column of the week view. */
export async function visibleCalDay(page: Page, n: number): Promise<Locator> {
  const indices = await visibleCalDays(page);
  const idx = indices[Math.min(n, indices.length - 1)];
  return page.locator("[data-cal-day]").nth(idx);
}

/**
 * A settings row's control.
 *
 * `components/settings-form.tsx`'s `Row` renders the label and its control as
 * siblings with no `for`/`id` pair, so `getByLabel` cannot reach the control.
 * ⚠️ Query `data-setting-row`, never the layout classes — a selector written
 * against a Tailwind utility stops matching the first time the grid is
 * restyled, and it does so silently, leaving this suite green while testing
 * nothing.
 */
export function settingControl(page: Page, label: string): Locator {
  return page
    .locator(`[data-setting-row=${JSON.stringify(label)}]`)
    .locator("button, input, select");
}

/**
 * Run `act()` and resolve once a Server Action it DISPATCHED has come back.
 *
 * ⚠️ **Not a bare `page.waitForResponse`, and the difference is the whole
 * check.** Every Server Action in this app posts to the same URL, so a waiter
 * registered around a click also matches a request that was already in flight
 * from the previous step — it resolves happily while the write under test has
 * not gone out at all, and the reload that follows then races the debounce.
 * Requests are recorded at DISPATCH time here and the predicate only accepts a
 * response belonging to one of those, so nothing already in flight can satisfy
 * it.
 *
 * ⚠️ It waits for the RESPONSE, not the request: a dispatched write that the
 * server has not answered yet has not been committed, and a reload issued on
 * the dispatch alone would read the row back before it changed.
 *
 * The board debounces the eight settings it owns by 400 ms — collapsing ten
 * rows, or stamping every lane with Shift+E, must cost one Server Action and
 * not ten — so the optimistic change is on screen long before anything has left
 * the browser. A timeout here means no write was issued, which is exactly the
 * signal the specs that use it want to be able to give.
 *
 * ⚠️ **Shared by `ui-state.spec.ts` and `ui-chip-mode.spec.ts` on purpose.**
 * Both drive the same debounced eight-key patch, and a second copy of this
 * would be a second place for the dispatch-vs-in-flight subtlety above to be
 * lost.
 */
export async function withWrite(
  page: Page,
  act: () => Promise<void>,
): Promise<void> {
  const dispatched = new Set<Request>();
  const note = (r: Request) => {
    if (r.method() === "POST") dispatched.add(r);
  };
  page.on("request", note);
  try {
    const settled = page.waitForResponse(
      (res) => dispatched.has(res.request()),
      // Bounded well under the test timeout so "no write was issued" reds
      // quickly and legibly instead of expiring the whole test.
      { timeout: 5_000 },
    );
    await act();
    await settled;
  } finally {
    page.off("request", note);
  }
}
