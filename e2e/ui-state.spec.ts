import { expect, test } from "@playwright/test";
import {
  boardCard,
  createBlock,
  createItem,
  openBoard,
  reloadBoard,
  settingControl,
  withWrite,
} from "./helpers";

/**
 * Board presentation state is stored, not window-local.
 *
 * ⚠️ **Why this spec exists at all.** Chip mode, the collapsed-item set and the
 * last-used lane used to live in `localStorage`. That is partitioned by ORIGIN,
 * and an origin contains a PORT — and the desktop shell binds a loopback port
 * chosen at runtime. So every one of these was only as durable as a port
 * number: a port that moved silently re-expanded every item the person had
 * collapsed and reset every chip. Nothing threw; the state was simply gone.
 * They are ordinary `user_settings` keys now.
 *
 * ⚠️ **A fresh browser context is the whole proof.** Playwright gives each test
 * its own context, so `localStorage` is EMPTY when these assertions run. Any
 * state that survives therefore came out of the SQLite file and could not have
 * come from anywhere else — which is precisely the property that regressed
 * before, and precisely what a same-context reload could not distinguish.
 *
 * ⚠️ **BOTH directions of the round trip are pinned, and that is not
 * symmetry for its own sake.** The board persists these keys through one
 * debounced effect, and an earlier form of that effect compared the live values
 * against the `settings` PROP — a server-render snapshot nothing refreshes. A
 * value changed and then changed BACK inside one page life therefore compared
 * equal to the snapshot and its corrective write was skipped, leaving the row
 * on the intermediate value. MEASURED: collapse a task, expand it again, quit,
 * relaunch — the task came back COLLAPSED. Only the outbound leg was covered
 * here at the time, so the suite was green throughout. The second test below
 * drives the round trip inside ONE page life, which is the only shape that
 * reproduces it; with the defect present its second wait for a write times out.
 *
 * `lib/types/settings.test.ts` pins the delta arithmetic these depend on. What
 * only this layer can prove is the board actually writing through it, because
 * `components/**` is outside vitest's include entirely.
 *
 * MUTATION TEST, executed while writing this file — each named test goes red:
 *  - seed `collapsedItems` from `new Set()` instead of `settings` → test 1;
 *  - restore the `settings`-prop comparison in the persist effect → test 2;
 *  - drop `?? lastBlockId` from the New-item modal's `defaultBlockId` → test 3;
 *  - remove `useFlushOnUnload` from `board.tsx` → **"a board change left inside
 *    the debounce window still reaches the database"**, whose `withWrite` times
 *    out because no Server Action is ever issued;
 *  - remove it from `settings-form.tsx` → **"a Settings field changed and left
 *    behind inside the debounce window is not lost"**, the same way.
 *
 * ⚠️ **The last two are about the OTHER way a debounced write is lost: not
 * compared away, but CANCELLED.** Both auto-saving surfaces used to tear their
 * 400 ms timer down with a bare `clearTimeout`, so leaving inside that window —
 * and "Settings" is one click from the board, "Back" one click from every
 * control on Settings — issued no write at all. `useFlushOnUnload`
 * (`lib/hooks/use-flush-on-unload.ts`) fires the pending patch on unmount and on
 * `pagehide`; it is a no-op once the timer has already fired, so one departure
 * still costs one write.
 */
test.describe.configure({ mode: "serial" });

const LANE = "E2E UI State Lane";
const TASK = "E2E UI State Task";
/** A step-row height nothing else in the suite uses, restored at the end. */
const ROW_H = "41";

test.describe("board UI state survives a reload", () => {
  test("a collapsed task is still collapsed after a reload", async ({
    page,
  }) => {
    await openBoard(page);
    await createBlock(page, LANE);
    await createItem(page, TASK, LANE);

    const row = page.locator("[data-item-row]").filter({ hasText: TASK });
    // Positive control: the task starts EXPANDED, so the assertion after the
    // reload cannot be satisfied by a board that never changed. The chevron's
    // title is the state — "Collapse steps" is offered only when expanded.
    await expect(row.getByTitle("Collapse steps")).toBeVisible();

    // ⚠️ **No reload between the create and the collapse, on purpose.**
    // Creating a task sets `lastBlockId`, which the board carries in the SAME
    // debounced eight-key patch as the collapse — so this one awaited write
    // persists both, and the third test can read the lane back. MEASURED with
    // a reload here instead: the 400 ms timer was destroyed with the page, the
    // key never reached the database, and the third test passed anyway against
    // a stored `lastBlockId` of NULL.
    await withWrite(page, () => row.getByTitle("Collapse steps").click());

    await reloadBoard(page);
    await expect(row.getByTitle("Expand steps")).toBeVisible();
    await expect(row.getByTitle("Collapse steps")).toHaveCount(0);
  });

  test("a value changed and changed BACK inside one page life still reaches the database", async ({
    page,
  }) => {
    // ⚠️ **The round trip has to happen without a reload in the middle, and
    // that is the entire point of this test.** Toggling once from a freshly
    // loaded page is a change away from the load value and was never the bug;
    // the bug was the return leg, where the live value comes back to exactly
    // what the page rendered with. A version of this test that expanded once
    // on a fresh page passed against the defect — MEASURED — which is why the
    // sequence below stays in one page life and only then reloads.
    await openBoard(page);
    const row = page.locator("[data-item-row]").filter({ hasText: TASK });

    // Positive control: the previous test left it collapsed, so a board that
    // silently forgot everything would fail here rather than later.
    await expect(row.getByTitle("Expand steps")).toBeVisible();

    // Away from the load value…
    await withWrite(page, () => row.getByTitle("Expand steps").click());
    await expect(row.getByTitle("Collapse steps")).toBeVisible();
    // …and back to it. With the defect this second write is never issued and
    // `withWrite` times out; the reload below then finds the item expanded,
    // so the test reds twice over rather than relying on either signal alone.
    await withWrite(page, () => row.getByTitle("Collapse steps").click());

    await reloadBoard(page);
    await expect(row.getByTitle("Expand steps")).toBeVisible();
    await expect(row.getByTitle("Collapse steps")).toHaveCount(0);
  });

  test("the New-task modal still offers the lane the last task went into", async ({
    page,
  }) => {
    // The first test put a task in LANE. `lastBlockId` recorded it, and the
    // toolbar's modal — which carries no lane of its own — should offer it.
    // ⚠️ MEASURED before this moved out of `localStorage`: the toolbar modal
    // fell back to the seeded `General` lane in a fresh context every time,
    // because the key was written into an origin this context does not share.
    await openBoard(page);
    await page.getByTitle("New item (C)").click();
    await expect(
      page.getByPlaceholder("e.g. Study for Math Exam"),
    ).toBeVisible();

    // ⚠️ **Scoped to the modal's Block field, and that is the check.** The
    // lane's own header in the sidebar is also a button whose accessible name
    // is the lane's name, so an unscoped `getByRole("button", { name: LANE })`
    // matches it THROUGH the open modal — it passes while the picker is
    // showing `General`, and would strict-mode-fail the moment the feature
    // started working and the count went from one to two. MEASURED: the
    // unscoped form ran green on a database whose `lastBlockId` was NULL.
    //
    // The field is addressed by its own label rather than by a layout class,
    // the way `quickAccess()` in `helpers.ts` addresses the board grid: the
    // innermost element containing the text `Block` is the field that holds
    // the label and the picker, and the picker is the only button in it.
    const blockField = page
      .locator("div")
      .filter({ has: page.getByText("Block", { exact: true }) })
      .last();
    await expect(blockField.getByRole("button")).toHaveText(new RegExp(LANE));
  });

  test("a board change left inside the debounce window still reaches the database", async ({
    page,
  }) => {
    await openBoard(page);
    const row = page.locator("[data-item-row]").filter({ hasText: TASK });
    // Positive control: the earlier tests left it collapsed, so the assertion
    // at the end is about a value that genuinely moved.
    await expect(row.getByTitle("Expand steps")).toBeVisible();

    // ⚠️ **Both clicks happen in ONE synchronous task, and that is the whole
    // reason this is an `evaluate` rather than two `locator.click()`s.** The
    // test is only meaningful if the departure beats the 400 ms debounce; two
    // Playwright clicks are usually tens of milliseconds apart, but MEASURED
    // under an 8× CPU throttle the gap was **390 ms** — one millisecond of
    // margin — and the Settings equivalent below went to **436 ms**, i.e. past
    // the timer. At that point the ordinary debounce satisfies `withWrite`, the
    // flush is never exercised, and the test passes while proving nothing. A
    // check that cannot distinguish "passed" from "did not run" is not a check.
    // Dispatching both clicks inside one `page.evaluate` makes the gap
    // sub-millisecond on any machine, so the timer provably has not fired.
    //
    // `click()` on a real element still goes through React's own handler —
    // click is a discrete event, so React flushes the state update
    // synchronously before `dispatchEvent` returns and the flush therefore
    // closes over the NEW patch, not the old one. (If it did not, this test
    // would red rather than pass silently: the write would carry the old value
    // and the final assertion would fail.)
    await withWrite(page, () =>
      page.evaluate((task) => {
        const row = [
          ...document.querySelectorAll<HTMLElement>("[data-item-row]"),
        ].find((el) => el.textContent?.includes(task));
        const chevron = row?.querySelector<HTMLElement>(
          '[title="Expand steps"]',
        );
        const gear = document.querySelector<HTMLAnchorElement>(
          'a[title="Settings"]',
        );
        // Throwing here reds the test loudly; a silent no-op would make the
        // assertions below meaningless.
        if (!chevron) throw new Error("no collapsed task to expand");
        if (!gear) throw new Error("no Settings link in the top bar");
        chevron.click();
        gear.click();
      }, TASK),
    );

    // Positive control on the departure itself: this really was an in-window
    // route change that unmounted the board, not a click that did nothing.
    await expect(page.getByText("Accent color")).toBeVisible();

    await openBoard(page);
    await expect(row.getByTitle("Collapse steps")).toBeVisible();
    await expect(row.getByTitle("Expand steps")).toHaveCount(0);
  });

  test("a Settings field changed and left behind inside the debounce window is not lost", async ({
    page,
  }) => {
    // ⚠️ **Reach Settings the way a person does — through the picker — rather
    // than with a bare `goto`.** The "Back" button is `router.back()`, so on a
    // page whose only history entry is this one it leaves the application
    // entirely: MEASURED, that is a cross-document navigation, the flush's
    // request dies with the document, and this test failed against a fix that
    // works. Arriving from `/app` makes Back an in-window route change, which
    // is the departure the flush is actually for.
    await page.goto("/app");
    await expect(boardCard(page, "My Board")).toBeVisible();
    await page.getByTitle("Settings").click();
    await expect(page.getByText("Accent color")).toBeVisible();

    const field = () => settingControl(page, "Step row height (px)").first();
    const original = await field().inputValue();
    // Positive control on the setup: the value this test writes is not the one
    // already stored, so the assertion below cannot pass on an unchanged row.
    expect(original).not.toBe(ROW_H);

    // ⚠️ One synchronous task, for the reason spelled out on the previous
    // test — MEASURED at 8× throttle, a `fill()` followed by a `click()` took
    // **436 ms**, past the 400 ms debounce, and this test then asserted
    // nothing at all.
    //
    // ⚠️ The value is set through the PROTOTYPE setter rather than by
    // assignment. React installs its own `value` setter to track changes, so a
    // plain `input.value = x` is recorded as "no change" and `onChange` never
    // fires — the same trap `e2e/settings.spec.ts` documents from the other
    // direction, where a synthetic assignment made a write silently never
    // happen. Calling the native setter first is what makes the dispatched
    // `input` event a real change. The ordinary typed-gesture path through this
    // same form is covered by `settings.spec.ts`; what this test needs and that
    // one does not is a departure inside the debounce window.
    await withWrite(page, () =>
      page.evaluate((v) => {
        const input = document.querySelector<HTMLInputElement>(
          '[data-setting-row="Step row height (px)"] input',
        );
        const back = document.querySelector<HTMLButtonElement>(
          'button[title="Back"]',
        );
        if (!input) throw new Error("no step-row-height input");
        if (!back) throw new Error("no Back button");
        const native = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        if (!native) throw new Error("no native value setter");
        native.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        back.click();
      }, ROW_H),
    );

    // Positive control on the departure itself: Back really did leave.
    await expect(boardCard(page, "My Board")).toBeVisible();

    await page.goto("/settings");
    await expect(field()).toHaveValue(ROW_H);

    // ⚠️ Put it back. `rowH` is one of the eight keys the BOARD also writes,
    // and every spec after this one opens a board — leaving a value here for
    // the board to re-persist is exactly the cross-spec coupling
    // `ui-chip-mode.spec.ts`'s restore hook exists to avoid.
    await withWrite(page, () => field().fill(original));
    await page.goto("/settings");
    await expect(field()).toHaveValue(original);
  });
});
