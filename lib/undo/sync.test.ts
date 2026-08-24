/**
 * Unit tests for lib/undo/sync.ts
 *
 * These exist for one reason: **undo must never send a version precondition.**
 *
 * A stale-write guard lands a write only while the row still carries the
 * version the caller read. Undo restores a snapshot *over* whatever is current
 * — that is what undo is — so the row has moved by definition and such a guard
 * would reject every undo, permanently.
 *
 * No write action accepts one today, so these assertions now serve a second
 * purpose: they are what goes red if one is reintroduced and threaded through
 * here "for consistency". Prose does not hold — a third argument can be added
 * to all four call sites, break every undo, typecheck, and leave the whole
 * suite green. That is the whole failure mode: correct, correctly reasoned, and
 * silently wrong the day someone tidies it onto a shiny new guard.
 *
 * So this asserts the ARITY. `toHaveBeenCalledWith(id, patch)` is not enough on
 * its own — what actually bites is the argument count.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Block, Deadline, Item, Step } from "@/lib/types/database";
import type { SnapshotDiff } from "./snapshot";

vi.mock("@/app/actions", () => ({
  createBlock: vi.fn(async () => undefined),
  createDeadline: vi.fn(async () => undefined),
  createItemWithSteps: vi.fn(async () => undefined),
  deleteBlock: vi.fn(async () => undefined),
  deleteDeadline: vi.fn(async () => undefined),
  deleteItem: vi.fn(async () => undefined),
  deleteStep: vi.fn(async () => undefined),
  updateBlock: vi.fn(async () => undefined),
  updateItem: vi.fn(async () => undefined),
  updateStep: vi.fn(async () => undefined),
  updateSettings: vi.fn(async () => undefined),
  addStepAt: vi.fn(async () => undefined),
}));

import {
  addStepAt,
  createBlock,
  createDeadline,
  createItemWithSteps,
  updateItem,
  updateStep,
} from "@/app/actions";
import { applyDiff } from "./sync";

/** A stored `updated_at`, so a guarded call would have something to send. */
const V = "2026-07-16T10:00:00.123Z";

const step: Step = {
  id: "11111111-1111-4111-8111-111111111111",
  board_id: "b1",
  item_id: "22222222-2222-4222-8222-222222222222",
  day_offset: 0,
  origin_day_offset: null,
  label: "restored label",
  notes: null,
  status: "todo",
  time_of_day: null,
  duration_min: null,
  detached: false,
  completed_at: null,
  created_at: V,
  updated_at: V,
};

const item: Item = {
  id: "22222222-2222-4222-8222-222222222222",
  board_id: "b1",
  block_id: null,
  prev_block_id: null,
  title: "restored title",
  start_date: "2026-07-16",
  duration_days: 1,
  deadline_offset: 1,
  deadline_id: null,
  color: null,
  recurrence: null,
  sort_order: 1,
  created_at: V,
  updated_at: V,
};

const empty = <T>() => ({
  created: [] as T[],
  deleted: [] as string[],
  updated: [] as T[],
});

/** A diff that updates one existing step and one existing item — the undo path. */
const diff: SnapshotDiff = {
  blocks: empty<Block>(),
  items: { ...empty<Item>(), updated: [item] },
  steps: { ...empty<Step>(), updated: [step] },
  deadlines: empty<Deadline>(),
  pinnedChanged: false,
};

describe("undo applyDiff", () => {
  beforeEach(() => {
    vi.mocked(updateStep).mockClear();
    vi.mocked(updateItem).mockClear();
  });

  it("restores the step's fields", () => {
    // Non-vacuity: if the diff stops reaching updateStep at all, the arity
    // assertions below pass while testing nothing.
    return applyDiff(diff, [step], []).then(() => {
      expect(vi.mocked(updateStep)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(updateStep).mock.calls[0][0]).toBe(step.id);
      expect(vi.mocked(updateStep).mock.calls[0][1]).toMatchObject({
        label: "restored label",
      });
    });
  });

  it("writes steps unguarded — undo must overwrite whatever is current", async () => {
    await applyDiff(diff, [step], []);
    // The arity is the assertion. A third argument here would make the write
    // require a version that undo has, by definition, already moved past — so
    // every undo would be rejected and silently do nothing.
    expect(vi.mocked(updateStep).mock.calls[0]).toHaveLength(2);
    // @ts-expect-error — `updateStep` takes two arguments, so index 2 is off the
    // end of the tuple. ⚠️ The unused-directive error IS the second alarm: if a
    // third parameter is ever added back, this index becomes valid, the
    // directive becomes unused, and `tsc` fails the build.
    expect(vi.mocked(updateStep).mock.calls[0][2]).toBeUndefined();
  });

  it("writes items unguarded — same reason", async () => {
    await applyDiff(diff, [step], []);
    expect(vi.mocked(updateItem)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateItem).mock.calls[0]).toHaveLength(2);
    // @ts-expect-error — same alarm as above, for the item write.
    expect(vi.mocked(updateItem).mock.calls[0][2]).toBeUndefined();
  });

  it("never passes a row's updated_at to any write it issues", async () => {
    await applyDiff(diff, [step], []);
    // Broader than the arity checks: the value must not reach the server in any
    // argument position, however the call is later reshaped.
    const everyArg = [
      ...vi.mocked(updateStep).mock.calls.flat(),
      ...vi.mocked(updateItem).mock.calls.flat(),
    ];
    expect(JSON.stringify(everyArg)).not.toContain(V);
  });
});

describe("undo-of-delete restores", () => {
  // Undoing a deletion re-CREATES rows, and the create schemas REQUIRE
  // board_id (blockCreateSchema/itemCreateSchema/deadlineCreateSchema). The
  // payloads omitted it for months: every restore failed Zod server-side, was
  // swallowed by `safe()`, and the "restored" row existed only until reload.
  // These pin the payloads to the schema's requirements.
  const block: Block = {
    id: "33333333-3333-4333-8333-333333333333",
    board_id: "b1",
    name: "restored block",
    color: "#112233",
    icon: null,
    sort_order: 1,
    collapsed: false,
    archived: false,
    is_system: false,
    created_at: V,
    updated_at: V,
  };
  const deadline: Deadline = {
    id: "44444444-4444-4444-8444-444444444444",
    board_id: "b1",
    name: "restored deadline",
    color: "#112233",
    date: "2026-07-20",
    created_at: V,
  };
  const createDiff: SnapshotDiff = {
    blocks: { ...empty<Block>(), created: [block] },
    items: { ...empty<Item>(), created: [item] },
    steps: { ...empty<Step>(), created: [] },
    deadlines: { ...empty<Deadline>(), created: [deadline] },
    pinnedChanged: false,
  };

  beforeEach(() => {
    vi.mocked(createBlock).mockClear();
    vi.mocked(createDeadline).mockClear();
    vi.mocked(createItemWithSteps).mockClear();
    vi.mocked(addStepAt).mockClear();
  });

  it("re-creates blocks, items, and deadlines WITH their board scope", async () => {
    await applyDiff(createDiff, [step], []);
    expect(vi.mocked(createBlock).mock.calls[0][0]).toMatchObject({
      id: block.id,
      board_id: "b1",
    });
    expect(vi.mocked(createItemWithSteps).mock.calls[0][0]).toMatchObject({
      id: item.id,
      board_id: "b1",
    });
    expect(vi.mocked(createDeadline).mock.calls[0][0]).toMatchObject({
      id: deadline.id,
      board_id: "b1",
    });
  });

  it("re-creates a standalone step under its ORIGINAL id", async () => {
    const standaloneDiff: SnapshotDiff = {
      blocks: empty<Block>(),
      items: empty<Item>(),
      steps: { ...empty<Step>(), created: [step] },
      deadlines: empty<Deadline>(),
      pinnedChanged: false,
    };
    await applyDiff(standaloneDiff, [step], []);
    // addStepAt upserts on a provided id; without it the server minted a fresh
    // id, the follow-up field restore hit "Step not found" (swallowed), and
    // the restored step came back BLANK after reload.
    expect(vi.mocked(addStepAt)).toHaveBeenCalledWith(
      step.item_id,
      step.day_offset,
      step.id,
    );
  });
});
