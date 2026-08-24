import { expect, test } from "@playwright/test";
import {
  columnWidth,
  createItem,
  dragBy,
  itemBar,
  openBoard,
  reloadBoard,
} from "./helpers";

/**
 * Moving and resizing a task bar, over the wire and back out of SQLite.
 *
 * This is the only automated exercise of `applyItemMove` and `resizeItem`
 * through the real Server Action encoding, and the only check of the
 * commit-on-RELEASE contract: `mousemove` may touch client state freely, but
 * exactly one write happens, at `mouseup`. Asserting mid-gesture would prove
 * nothing about what landed.
 *
 * ⚠️ The bar's start is read from its own geometry rather than from a
 * screenshot, and every assertion is made after a reload, for the same reason
 * as `board-crud.spec.ts`.
 */
test.describe.configure({ mode: "serial" });

const TASK = "E2E Drag";

test.describe("dragging a bar", () => {
  test("moving a bar two columns right persists", async ({ page }) => {
    await openBoard(page);
    await createItem(page, TASK);

    const colW = await columnWidth(page);
    const bar = itemBar(page, TASK);
    const before = await bar.boundingBox();
    expect(before).not.toBeNull();

    await dragBy(page, bar, colW * 2);

    // ⚠️ Moving a bar FORWARD is confirmed, because the item's deadline is
    // anchored to its start and rides along. MEASURED: without answering this
    // dialog the bar springs back to its original column and nothing is
    // written, which is exactly what a broken `applyItemMove` would look like —
    // so the confirmation is asserted rather than dismissed blindly.
    await expect(
      page.getByText("Moving this task will shift its deadline"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Move", exact: true }).click();

    await reloadBoard(page);
    const after = await itemBar(page, TASK).boundingBox();
    expect(after).not.toBeNull();
    // Roughly two columns to the right, tolerant of sub-pixel column widths.
    expect(after!.x - before!.x).toBeGreaterThan(colW * 1.5);
    expect(after!.x - before!.x).toBeLessThan(colW * 2.5);
  });

  test("resizing the right edge one column persists", async ({ page }) => {
    await openBoard(page);
    const colW = await columnWidth(page);
    const bar = itemBar(page, TASK);
    const before = await bar.boundingBox();
    expect(before).not.toBeNull();

    // The resize affordance lives at the bar's right edge.
    const handle = bar.locator("[data-resize]").last();
    const hasHandle = (await handle.count()) > 0;
    const grip = hasHandle ? handle : bar;
    const box = await grip.boundingBox();
    expect(box).not.toBeNull();
    const y = box!.y + box!.height / 2;
    const x = hasHandle
      ? box!.x + box!.width / 2
      : before!.x + before!.width - 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + colW / 2, y, { steps: 4 });
    await page.mouse.move(x + colW, y, { steps: 4 });
    await page.mouse.up();

    await reloadBoard(page);
    const after = await itemBar(page, TASK).boundingBox();
    expect(after).not.toBeNull();
    expect(after!.width).toBeGreaterThan(before!.width + colW * 0.5);
  });
});
