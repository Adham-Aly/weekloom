import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { insertBoard } from "@/lib/db/boards";
import { getDb } from "@/lib/db/connection";
import { DbInvalidInputError, DbMissingRowError } from "@/lib/db/errors";
import { upsertItem } from "@/lib/db/items";
import { swapSteps } from "@/lib/db/rpc/swap-steps";
import { getStep, upsertStep } from "@/lib/db/steps";
import { setUpTempDb } from "@/lib/db/test-support";
import type { Item } from "@/lib/types/database";

setUpTempDb();

function item(): Item {
  const board = insertBoard({ name: "B" });
  return upsertItem({
    board_id: board.id,
    title: "T",
    start_date: "2026-08-23",
    duration_days: 60,
  });
}

function occurrence(parent: Item, offset: number) {
  return upsertStep({
    item_id: parent.id,
    board_id: parent.board_id,
    day_offset: offset,
    origin_day_offset: offset,
  });
}

describe("swapSteps", () => {
  it("exchanges the two day_offsets", () => {
    const parent = item();
    const a = occurrence(parent, 7);
    const b = occurrence(parent, 14);
    swapSteps(a.id, b.id);
    expect(getStep(a.id)?.day_offset).toBe(14);
    expect(getStep(b.id)?.day_offset).toBe(7);
  });

  it("⚠️ marks BOTH rows detached", () => {
    // Mutation test: delete `detached = 1` from either statement in
    // lib/db/rpc/swap-steps.ts and this goes red.
    //
    // A swap IS a manual placement, and it is the only writer that moves a step
    // off its rule slot. Without the flag a non-detached series step sits where
    // the rule never put it, the materializer reads its position as a rule slot,
    // and the watermark is poisoned — reproduced as five occurrences silently
    // skipped on a Monday series.
    const parent = item();
    const a = occurrence(parent, 7);
    const b = occurrence(parent, 14);
    swapSteps(a.id, b.id);
    expect(getStep(a.id)?.detached).toBe(true);
    expect(getStep(b.id)?.detached).toBe(true);
  });

  it("⚠️ leaves origin_day_offset untouched on both", () => {
    // It is the slot the RULE put the occurrence in, and a user moving the
    // occurrence does not change that. Freezing it is the column's entire job.
    const parent = item();
    const a = occurrence(parent, 7);
    const b = occurrence(parent, 14);
    swapSteps(a.id, b.id);
    expect(getStep(a.id)?.origin_day_offset).toBe(7);
    expect(getStep(b.id)?.origin_day_offset).toBe(14);
  });

  it("throws DbInvalidInputError across items and writes nothing", () => {
    const one = item();
    const two = item();
    const a = occurrence(one, 1);
    const b = occurrence(two, 2);
    const before = getDb().prepare("SELECT * FROM steps ORDER BY id").all();
    expect(() => swapSteps(a.id, b.id)).toThrow(DbInvalidInputError);
    expect(getDb().prepare("SELECT * FROM steps ORDER BY id").all()).toEqual(
      before,
    );
  });

  it("throws DbMissingRowError when either id is unknown", () => {
    const parent = item();
    const a = occurrence(parent, 1);
    expect(() => swapSteps(a.id, randomUUID())).toThrow(DbMissingRowError);
    expect(() => swapSteps(randomUUID(), a.id)).toThrow(DbMissingRowError);
    // And nothing was written on the way to the throw.
    expect(getStep(a.id)?.day_offset).toBe(1);
    expect(getStep(a.id)?.detached).toBe(false);
  });

  it("bumps updated_at on both rows", () => {
    const parent = item();
    const a = occurrence(parent, 3);
    const b = occurrence(parent, 4);
    swapSteps(a.id, b.id);
    expect(
      Date.parse(getStep(a.id)!.updated_at) >= Date.parse(a.updated_at),
    ).toBe(true);
    expect(
      Date.parse(getStep(b.id)!.updated_at) >= Date.parse(b.updated_at),
    ).toBe(true);
  });
});
