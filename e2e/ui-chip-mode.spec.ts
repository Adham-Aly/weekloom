import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  blockSection,
  createBlock,
  createItem,
  openBoard,
  reloadBoard,
  withWrite,
} from "./helpers";

/**
 * The T/E chip: which one a lane draws, who decides, and that the decision
 * survives a relaunch.
 *
 * ⚠️ **Why this file exists.** `board.tsx` passed the LITERAL `chipMode="T"` to
 * every `BlockSection`, so the whole feature was inert behind it: the per-block
 * map persisted, Shift+T / Shift+E fired and wrote, the Settings control saved
 * its value — and the render never looked at any of it. Nothing threw, nothing
 * logged, and the entire suite stayed green, because no test had ever asserted
 * which chip a step row draws. That is the exact failure class AGENTS.md calls
 * "a check that cannot distinguish passed from did not run", one level up: no
 * check at all. This file is the check.
 *
 * The resolution under test is one expression:
 *
 *     chipMode = chipModeByBlock[block.id] ?? settings.defaultChipMode
 *
 * so it takes three assertions to pin it, and all three are here: a lane with
 * an entry uses its entry, a lane WITHOUT one falls through to the document
 * default, and the default is the one the Settings control writes rather than a
 * hardcoded "T" — all three in **"a lane's own choice outranks the document
 * default"**, which sets Settings to *Effort* first.
 *
 * ⚠️ **Tests are named, never numbered, in every note below.** `mode: "serial"`
 * makes the order load-bearing and a test inserted in the middle silently
 * renumbers every claim after it.
 *
 * ⚠️ **Every persistence claim is asserted across a RELOAD, in the fresh
 * browser context Playwright gives each test.** Reading back what the click
 * just drew proves only that React state changed; an empty `localStorage` on
 * every test means anything that survives demonstrably came out of SQLite.
 *
 * ⚠️ **`TimeChip` renders NOTHING when a step has no time** (it returns null),
 * so a step created with the default modal draws an empty chip slot in T mode
 * and an effort input in E mode. A test that only looked for "no effort input"
 * would therefore pass against a T branch that rendered nothing at all. The
 * first test puts a real time on the step, so both arms of the ternary are
 * asserted by their CONTENT and not merely by each other's absence.
 *
 * MUTATION TEST — all four were APPLIED to the source, rebuilt with
 * `npm run app:build`, run, and reverted. Each reds the test named against it;
 * `mode: "serial"` then skips whatever follows, which is why only one failure
 * is quoted per mutation:
 *
 *  1. restore the literal `chipMode="T"` at the `BlockSection` call site
 *     → **"Shift+E swaps it for the effort input"** red,
 *     `expect(effortInput).toHaveCount(1)` resolving to 0; everything after it
 *     did not run.
 *  2. hardcode the fallback — `chipModeByBlock[block.id] ?? "T"` — so the map
 *     still wins but the Settings default is never read → **"a lane's own
 *     choice outranks the document default"** red, and every other test still
 *     GREEN. That combination is the point: it is the only mutation the rest of
 *     the file cannot see, and the reason that test exists.
 *  3. drop the fallback entirely, leaving `chipModeByBlock[block.id]`, so a
 *     lane with no entry gets `undefined` and takes the E branch → **"a lane
 *     with no stored choice draws the time chip"** red on the missing chip;
 *     everything after it did not run.
 *  4. remove the 1440 clamp from `step-row.tsx`'s `commitEffort`, restoring
 *     the bare `n !== step.duration_min` → **"an out-of-range estimate is
 *     clamped"** red with `Received: "2000"`, which is the defect's own
 *     signature: the typed number still sitting in the field. The server log
 *     carried the matching `ActionError` and the reload assertion never got to
 *     run, so the first expect is the one that reds — deliberately, since it
 *     is the on-screen half a person would actually see.
 */
test.describe.configure({ mode: "serial" });

const LANE = "E2E Chip Lane";
const TASK = "E2E Chip Task";
/** A second lane, created AFTER a chip choice, so it has no stored entry. */
const FRESH_LANE = "E2E Chip Fresh Lane";
const FRESH_TASK = "E2E Chip Fresh Task";

/**
 * The time put on the step, and the text the chip renders it back as.
 * `parseFlexTime("9:30 AM")` stores `"09:30"` and `fmtTime12` reads it back
 * as `"9:30 AM"`, so one constant covers both ends of the round trip.
 */
const TIME = "9:30 AM";

/**
 * A task's step rows, addressed through the DOM query protocol.
 *
 * `[data-step-sidebar]` is the sticky-left cell of one step row — checkbox,
 * label input and the chip slot. Scoping to it is load-bearing: the step's own
 * cell out in the grid ALSO renders the time (`{step.time_of_day ? … }`), so an
 * unscoped `getByText("9:30 AM")` would match the grid pill and pass in either
 * chip mode.
 */
function stepSidebar(page: Page, lane: string, task: string): Locator {
  return blockSection(page, lane)
    .locator("[data-item-row]")
    .filter({ hasText: task })
    .locator("[data-step-sidebar]");
}

/** The E-mode control: the effort-minutes input, by its navigation column. */
function effortInput(sidebar: Locator): Locator {
  return sidebar.locator('input[data-nav-col="effort"]');
}

/**
 * Assert a task's step row is drawing the given chip.
 *
 * Both arms are asserted positively AND negatively, because either one alone
 * is satisfiable by a row that failed to render at all — which is why the
 * label input is checked first as the row's own positive control.
 */
async function expectChip(
  page: Page,
  lane: string,
  task: string,
  mode: "T" | "E",
): Promise<void> {
  const sb = stepSidebar(page, lane, task);
  await expect(sb.locator('input[data-nav-col="label"]')).toHaveCount(1);
  if (mode === "T") {
    await expect(sb.getByText(TIME)).toBeVisible();
    await expect(effortInput(sb)).toHaveCount(0);
  } else {
    await expect(effortInput(sb)).toHaveCount(1);
    await expect(sb.getByText(TIME)).toHaveCount(0);
  }
}

/**
 * Press a chip-mode shortcut and wait for the debounced settings write.
 *
 * ⚠️ The shortcut is ignored while focus is inside an input — `board.tsx`'s key
 * handler returns early on `editing` — so this presses Escape first, which is
 * the same gesture a person uses to leave a field. Playwright hands each test a
 * fresh page, so focus is on `<body>` anyway; the Escape is what keeps that
 * true for a test that typed into a cell before pressing a shortcut.
 */
async function pressChipShortcut(page: Page, key: "T" | "E"): Promise<void> {
  await page.keyboard.press("Escape");
  await withWrite(page, () => page.keyboard.press(`Shift+${key}`));
}

/**
 * The Settings radio for the document-wide default.
 *
 * ⚠️ `aria-pressed` is what says which option is stored. The segmented control
 * otherwise carries that in `bg-accent text-white`, and a selector written
 * against a Tailwind utility keeps matching until somebody restyles the
 * control — then it stops SILENTLY, leaving this spec green while it asserts
 * nothing. Same reasoning as `data-setting-row` itself.
 */
function defaultChipControl(page: Page, label: "Time" | "Effort"): Locator {
  return page
    .locator('[data-setting-row="Default chip for new blocks"]')
    .getByRole("button", { name: label, exact: true });
}

/**
 * Put the document default on `label`, and leave having verified it is there.
 *
 * ⚠️ **Idempotent, and that is required rather than tidy.** The Settings form
 * diffs against its last-saved snapshot and "a no-op delta skips the round trip
 * entirely" — so clicking the option that is ALREADY stored produces no write
 * and no "Saved" ping, and an unconditional `expect(getByText("Saved"))` would
 * time out. The `afterAll` below calls this when the stored value may be either
 * one, so the guard is the difference between a restore and a second failure
 * stacked on the first.
 */
async function setDefaultChip(
  page: Page,
  label: "Time" | "Effort",
): Promise<void> {
  await page.goto("/settings");
  const target = defaultChipControl(page, label);
  await expect(target).toBeVisible();
  if ((await target.getAttribute("aria-pressed")) !== "true") {
    await target.click();
    await expect(page.getByText("Saved")).toBeVisible();
  }
  await expect(target).toHaveAttribute("aria-pressed", "true");
}

/**
 * ⚠️ Put the shipped default back, whatever happened above.
 *
 * `defaultChipMode` is ONE row in ONE document shared by the whole run, and
 * Playwright orders spec files alphabetically — `ui-state`, `undo` and `views`
 * all run after this one against the same database. Leaving it on "Effort"
 * would silently change what every later spec's step rows draw. This is an
 * `afterAll` rather than a final test because `mode: "serial"` SKIPS the
 * remaining tests once one fails, and the restore must happen precisely then —
 * which is also why `setDefaultChip` has to tolerate the value already being
 * "T". MEASURED before it did: mutating the call site red-ed the Shift+E test,
 * nothing after it ran, the default was therefore still "T", and this hook
 * then failed on
 * a "Saved" ping that correctly never came — one defect reported as two.
 */
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await setDefaultChip(page, "Time");
  } finally {
    await page.close();
  }
});

test.describe("the T/E chip", () => {
  test("a lane with no stored choice draws the time chip", async ({ page }) => {
    await openBoard(page);
    await createBlock(page, LANE);
    await createItem(page, TASK, LANE);

    const sb = stepSidebar(page, LANE, TASK);
    // Give the step a real time, so the T arm has something to draw. Without
    // it `TimeChip` returns null and "T mode" and "a row that rendered
    // nothing" are indistinguishable. Double-clicking the step's grid cell is
    // the app's own gesture for opening the step editor.
    await blockSection(page, LANE)
      .locator("[data-cell-step-id]")
      .first()
      .dblclick();
    const timeField = page.getByPlaceholder("Set a time");
    await expect(timeField).toBeVisible();
    await timeField.fill(TIME);
    // Enter blurs the field, and the blur is what commits — so this is the
    // write to wait for. Escape then dismisses the editor.
    await withWrite(page, () => page.keyboard.press("Enter"));
    await page.keyboard.press("Escape");
    await expect(timeField).toBeHidden();

    // Positive control on the setup itself: the chip is there to be found.
    await expect(sb.getByText(TIME)).toBeVisible();
    await expectChip(page, LANE, TASK, "T");
  });

  test("Shift+E swaps it for the effort input, and that survives a reload", async ({
    page,
  }) => {
    await openBoard(page);
    // Positive control: the previous test's time survived, so a board that
    // forgot everything reds here rather than in the assertion this test is
    // about.
    await expectChip(page, LANE, TASK, "T");

    await pressChipShortcut(page, "E");
    await expectChip(page, LANE, TASK, "E");

    // ⚠️ The reload is the check. Before it, "E" is React state and could have
    // come from anywhere; after it, in a context whose `localStorage` was never
    // written, it can only have come out of `user_settings`.
    await reloadBoard(page);
    await expectChip(page, LANE, TASK, "E");
  });

  test("the effort input actually records an estimate", async ({ page }) => {
    await openBoard(page);
    const input = effortInput(stepSidebar(page, LANE, TASK));
    await expect(input).toHaveValue("");

    await input.fill("45");
    // Enter commits and moves on, exactly as Tab does — `commitEffort` runs on
    // both. This is NOT debounced: it is an ordinary step write, so the wait is
    // for that write rather than for a settings patch.
    await withWrite(page, () => page.keyboard.press("Enter"));

    await reloadBoard(page);
    await expect(effortInput(stepSidebar(page, LANE, TASK))).toHaveValue("45");
  });

  test("an out-of-range estimate is clamped, not silently discarded", async ({
    page,
  }) => {
    // ⚠️ **This is the regression test for a measured data loss**, and it only
    // became reachable when the chip repair started rendering this input.
    // `stepUpdateSchema` bounds `duration_min` to 1440, and `persist()` logs a
    // rejected write and does NOT roll back — so before the clamp, typing an
    // extra digit returned HTTP 500, left the typed number on screen, and gave
    // back the OLD value on the next launch, with nothing in the interface
    // saying anything had gone wrong.
    await openBoard(page);
    const input = effortInput(stepSidebar(page, LANE, TASK));
    // Positive control: the previous test's value is there, so the assertion
    // below cannot pass against a row that never rendered.
    await expect(input).toHaveValue("45");

    await input.fill("2000");
    await withWrite(page, () => page.keyboard.press("Enter"));

    // The clamp is visible in the field — which IS the feedback, since a
    // component in this app never raises a toast.
    await expect(effortInput(stepSidebar(page, LANE, TASK))).toHaveValue(
      "1440",
    );

    // …and the decisive half: 1440 is what is on disk, not 45 and not 2000.
    await reloadBoard(page);
    await expect(effortInput(stepSidebar(page, LANE, TASK))).toHaveValue(
      "1440",
    );
  });

  test("Shift+T switches back, and that survives a reload too", async ({
    page,
  }) => {
    await openBoard(page);
    await expectChip(page, LANE, TASK, "E");

    await pressChipShortcut(page, "T");
    await expectChip(page, LANE, TASK, "T");

    await reloadBoard(page);
    await expectChip(page, LANE, TASK, "T");
  });

  test("a lane's own choice outranks the document default", async ({
    page,
  }) => {
    // Every lane on the board carries a stored "T" at this point — Shift+T
    // stamps them all. Now flip the DOCUMENT default the other way. Positive
    // control on the setup: the control reads back as pressed, so the two
    // board assertions below cannot both be satisfied by a default that never
    // moved.
    await setDefaultChip(page, "Effort");
    await expect(defaultChipControl(page, "Effort")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await openBoard(page);
    // ⚠️ The stored per-lane "T" must win. If the call site read the default
    // first — or ignored the map — this lane would be showing an effort input.
    await expectChip(page, LANE, TASK, "T");

    // A lane created AFTER that stamping has no entry in the map, so it is the
    // one place the document default is observable. This is also what the
    // Settings control calls itself: "Default chip for new blocks".
    await createBlock(page, FRESH_LANE);
    await createItem(page, FRESH_TASK, FRESH_LANE);
    await expect(
      effortInput(stepSidebar(page, FRESH_LANE, FRESH_TASK)),
    ).toHaveCount(1);

    // …and the two lanes disagree ON THE SAME PAGE, which no single-lane
    // assertion can show: the override and the fallback are both live at once.
    await expect(effortInput(stepSidebar(page, LANE, TASK))).toHaveCount(0);
  });
});
