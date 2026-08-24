import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { insertBoard } from "@/lib/db/boards";
import { getDb } from "@/lib/db/connection";
import { DbInvalidInputError, DbMissingRowError } from "@/lib/db/errors";
import { getItem, upsertItem } from "@/lib/db/items";
import { applyItemMove } from "@/lib/db/rpc/apply-item-move";
import { getStep, listStepsByItem, upsertStep } from "@/lib/db/steps";
import { setUpTempDb } from "@/lib/db/test-support";
import type { Item, Step } from "@/lib/types/database";

setUpTempDb();

const START = "2026-08-23";

function series(over: Partial<{ start_date: string }> = {}): {
  item: Item;
  boardId: string;
} {
  const board = insertBoard({ name: "B" });
  const item = upsertItem({
    board_id: board.id,
    title: "T",
    start_date: over.start_date ?? START,
    duration_days: 30,
    deadline_offset: 30,
  });
  return { item, boardId: board.id };
}

/** A rule-generated occurrence: position and origin equal. */
function occurrence(item: Item, offset: number): Step {
  return upsertStep({
    item_id: item.id,
    board_id: item.board_id,
    day_offset: offset,
    origin_day_offset: offset,
  });
}

/** A manual step: a real row that the rule did not put anywhere. */
function manual(item: Item, offset: number): Step {
  return upsertStep({
    item_id: item.id,
    board_id: item.board_id,
    day_offset: offset,
  });
}

function snapshot(): unknown[] {
  return getDb().prepare("SELECT * FROM steps ORDER BY id").all();
}

describe("applyItemMove", () => {
  it("1. moves each supplied step to its new day_offset", () => {
    const { item } = series();
    const a = occurrence(item, 0);
    const b = occurrence(item, 7);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [
        { id: a.id, day_offset: 2 },
        { id: b.id, day_offset: 9 },
      ],
      ruleDelta: 0,
    });
    expect(getStep(a.id)?.day_offset).toBe(2);
    expect(getStep(b.id)?.day_offset).toBe(9);
  });

  it("2. leaves unsupplied steps of the same item untouched", () => {
    const { item } = series();
    const moved = occurrence(item, 0);
    const untouched = occurrence(item, 7);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [{ id: moved.id, day_offset: 3 }],
      ruleDelta: 0,
    });
    const after = getStep(untouched.id);
    expect(after?.day_offset).toBe(7);
    expect(after?.origin_day_offset).toBe(7);
    expect(after?.updated_at).toBe(untouched.updated_at);
  });

  it("3. ⚠️ a NULL origin_day_offset stays NULL through a move", () => {
    // A step with no origin is not a rule-generated occurrence. Giving it one
    // makes the materializer treat it as an occurrence and its watermark jumps
    // to wherever the user happened to put a manual step.
    const { item } = series();
    const step = manual(item, 5);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [{ id: step.id, day_offset: 9 }],
      newStartDate: "2026-08-20",
      ruleDelta: 4,
    });
    const after = getStep(step.id);
    expect(after?.day_offset).toBe(9);
    expect(after?.origin_day_offset).toBeNull();
  });

  it("4. rebases a non-null origin by (old start − new start)", () => {
    // Start slides two days EARLIER, so a fixed calendar occurrence's offset
    // from that start GROWS by two, and origin must grow with it.
    const { item } = series();
    const step = occurrence(item, 7);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [{ id: step.id, day_offset: 9 }],
      newStartDate: "2026-08-21",
      ruleDelta: 0,
    });
    expect(getStep(step.id)?.origin_day_offset).toBe(9);
  });

  it("5. ⚠️ a rotation (ruleDelta: 2, no newStartDate) SHIFTS origins by 2", () => {
    // The scope-"all" weekday rotation: the rule itself moved, so origin moves
    // with it. Paired with case 6, which arrives in the identical shape.
    const { item } = series();
    const a = occurrence(item, 0);
    const b = occurrence(item, 7);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [
        { id: a.id, day_offset: 2 },
        { id: b.id, day_offset: 9 },
      ],
      ruleDelta: 2,
    });
    expect(getStep(a.id)?.origin_day_offset).toBe(2);
    expect(getStep(b.id)?.origin_day_offset).toBe(9);
  });

  it("6. ⚠️ an arrow-shift (ruleDelta: 0, no newStartDate) FREEZES origins", () => {
    // The pair with case 5 is the whole point. Identical shape — N stepUpdates,
    // no newStartDate — and the opposite required behaviour. No formula can tell
    // them apart, which is why `ruleDelta` is required and never defaulted: a
    // `?? 0` here silently turns every rotation into this, and the materializer
    // then mints a duplicate on top of each occurrence that moved.
    const { item } = series();
    const step = occurrence(item, 21);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [{ id: step.id, day_offset: 15 }],
      ruleDelta: 0,
    });
    const after = getStep(step.id);
    expect(after?.day_offset).toBe(15);
    expect(after?.origin_day_offset).toBe(21);
  });

  it("7. ⚠️ a backward move produces a NEGATIVE origin and does not clamp at 0", () => {
    // `greatest(0, …)` is the actual bug: it collapses two distinct occurrences
    // onto one origin and the series duplicates. A negative origin is the honest
    // coordinate — "the rule's slot sits N days before this item starts".
    const { item } = series();
    const step = occurrence(item, 1);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [{ id: step.id, day_offset: 0 }],
      newStartDate: "2026-08-27",
      ruleDelta: 0,
    });
    expect(getStep(step.id)?.origin_day_offset).toBe(-3);
  });

  it("8. lands newStartDate, newDuration and newDeadlineOffset on the item", () => {
    const { item } = series();
    applyItemMove({
      itemId: item.id,
      stepUpdates: [],
      newStartDate: "2026-09-01",
      newDuration: 12,
      newDeadlineOffset: 14,
      ruleDelta: 0,
    });
    const after = getItem(item.id);
    expect(after?.start_date).toBe("2026-09-01");
    expect(after?.duration_days).toBe(12);
    expect(after?.deadline_offset).toBe(14);
  });

  it("9. omitting all three leaves the item row untouched, updated_at included", () => {
    const { item } = series();
    const step = occurrence(item, 0);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [{ id: step.id, day_offset: 1 }],
      ruleDelta: 0,
    });
    expect(getItem(item.id)).toEqual(item);
  });

  it("10. ⚠️ the step UPDATE runs BEFORE the item UPDATE", () => {
    // Asserted behaviourally, which is the only way it can be asserted. With
    // newStartDate two days earlier the origins must grow by exactly 2 — and
    // that is only true if the rebase read the OLD start. Update the item first
    // and the delta is zero, every origin freezes, and the materializer mints a
    // duplicate on top of each step that moved.
    const { item } = series();
    const a = occurrence(item, 0);
    const b = occurrence(item, 7);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [
        { id: a.id, day_offset: 2 },
        { id: b.id, day_offset: 9 },
      ],
      newStartDate: "2026-08-21",
      ruleDelta: 0,
    });
    expect(getStep(a.id)?.origin_day_offset).toBe(2);
    expect(getStep(b.id)?.origin_day_offset).toBe(9);
    expect(getItem(item.id)?.start_date).toBe("2026-08-21");
  });

  it("11. ⚠️ a duplicate step id throws DbInvalidInputError, NOT DbMissingRowError, and writes nothing", () => {
    // Two offsets for one step is an impossible request, not a concurrency
    // conflict. Reporting it as one tells the person their task changed
    // underneath them when nothing changed at all, and leaves the caller
    // handling a class of failure it cannot do anything about.
    const { item } = series();
    const step = occurrence(item, 0);
    const before = snapshot();
    let thrown: unknown;
    try {
      applyItemMove({
        itemId: item.id,
        stepUpdates: [
          { id: step.id, day_offset: 1 },
          { id: step.id, day_offset: 2 },
        ],
        ruleDelta: 0,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DbInvalidInputError);
    expect(thrown).not.toBeInstanceOf(DbMissingRowError);
    expect(snapshot()).toEqual(before);
  });

  it("12. an id belonging to a different item throws DbMissingRowError and writes nothing", () => {
    const { item } = series();
    const mine = occurrence(item, 0);
    const other = series();
    const theirs = occurrence(other.item, 0);
    const before = snapshot();
    expect(() =>
      applyItemMove({
        itemId: item.id,
        stepUpdates: [
          { id: mine.id, day_offset: 5 },
          { id: theirs.id, day_offset: 5 },
        ],
        ruleDelta: 0,
      }),
    ).toThrow(DbMissingRowError);
    expect(snapshot()).toEqual(before);
  });

  it("13. an unknown itemId throws DbMissingRowError", () => {
    expect(() =>
      applyItemMove({
        itemId: randomUUID(),
        stepUpdates: [],
        newStartDate: "2026-09-01",
        ruleDelta: 0,
      }),
    ).toThrow(DbMissingRowError);
  });

  it("14. an empty stepUpdates with newStartDate still moves the item", () => {
    const { item } = series();
    applyItemMove({
      itemId: item.id,
      stepUpdates: [],
      newStartDate: "2026-09-05",
      ruleDelta: 0,
    });
    expect(getItem(item.id)?.start_date).toBe("2026-09-05");
  });

  it("15. a detached step is moved like any other — detached is not consulted", () => {
    const { item } = series();
    const step = upsertStep({
      item_id: item.id,
      board_id: item.board_id,
      day_offset: 14,
      origin_day_offset: 14,
      detached: true,
    });
    applyItemMove({
      itemId: item.id,
      stepUpdates: [{ id: step.id, day_offset: 16 }],
      ruleDelta: 3,
    });
    const after = getStep(step.id);
    expect(after?.day_offset).toBe(16);
    expect(after?.origin_day_offset).toBe(17);
    expect(after?.detached).toBe(true);
  });

  it("16. the atomicity proof — 200 step updates roll back together", () => {
    // A partial match would leave an item whose steps sit at a mix of old and
    // new offsets. That is worse than any failure this could report, so the
    // whole apply is one transaction or it is nothing.
    const { item } = series();
    const steps = Array.from({ length: 200 }, (_, i) => occurrence(item, i));
    const before = snapshot();

    expect(() =>
      applyItemMove({
        itemId: item.id,
        stepUpdates: [
          ...steps.map((s, i) => ({ id: s.id, day_offset: i + 5 })),
          // The 201st names a step that does not exist, so the ownership
          // pre-check aborts everything above it.
          { id: randomUUID(), day_offset: 0 },
        ],
        newStartDate: "2026-08-01",
        ruleDelta: 0,
      }),
    ).toThrow(DbMissingRowError);

    expect(snapshot()).toEqual(before);
    expect(getItem(item.id)).toEqual(item);
    expect(listStepsByItem(item.id).map((s) => s.day_offset)).toEqual(
      steps.map((s) => s.day_offset),
    );
  });

  it("16b. the atomicity proof, part two — a failure AFTER the step writes rolls them back", () => {
    // Case 16 aborts in the ownership pre-check, i.e. before any write, so on
    // its own it proves the ordering rather than the rollback. This one lets the
    // step UPDATEs land and then fails the item UPDATE (duration_days has a
    // CHECK >= 1), which is the only shape that can distinguish a real ROLLBACK
    // from a COMMIT. Delete the rollback in lib/db/tx.ts and this goes red.
    const { item } = series();
    const steps = [occurrence(item, 0), occurrence(item, 7)];
    const before = snapshot();

    expect(() =>
      applyItemMove({
        itemId: item.id,
        stepUpdates: steps.map((s, i) => ({ id: s.id, day_offset: i + 3 })),
        newDuration: 0,
        ruleDelta: 0,
      }),
    ).toThrow(/CHECK/i);

    expect(snapshot()).toEqual(before);
    expect(getStep(steps[0].id)?.day_offset).toBe(0);
    expect(getStep(steps[1].id)?.day_offset).toBe(7);
    expect(getItem(item.id)).toEqual(item);
  });

  it("17. a step update with no id throws DbInvalidInputError and writes nothing", () => {
    const { item } = series();
    const step = occurrence(item, 0);
    const before = snapshot();
    expect(() =>
      applyItemMove({
        itemId: item.id,
        stepUpdates: [
          { id: step.id, day_offset: 1 },
          { id: "", day_offset: 2 },
        ],
        ruleDelta: 0,
      }),
    ).toThrow(DbInvalidInputError);
    expect(snapshot()).toEqual(before);
  });

  it("18. the item delta and ruleDelta ADD rather than replacing each other", () => {
    // A rotation performed at the same time as an item rebase. Origin absorbs
    // the coordinate change (+2) AND the rule's own move (+3).
    const { item } = series();
    const step = occurrence(item, 7);
    applyItemMove({
      itemId: item.id,
      stepUpdates: [{ id: step.id, day_offset: 12 }],
      newStartDate: "2026-08-21",
      ruleDelta: 3,
    });
    expect(getStep(step.id)?.origin_day_offset).toBe(12);
  });
});
