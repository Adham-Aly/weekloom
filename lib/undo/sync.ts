/**
 * Apply a SnapshotDiff to the server. Order matters for FK constraints:
 *   creates: blocks → deadlines → items → steps
 *   updates: any order
 *   deletes: steps → items → blocks/deadlines  (reverse of creates)
 *
 * Returns the number of server calls issued (for guardrail logging).
 * Failures are swallowed individually so a single bad row doesn't abort
 * the whole undo. The hook surfaces a generic error if any failed.
 */
import {
  createBlock,
  createDeadline,
  createItemWithSteps,
  deleteBlock,
  deleteDeadline,
  deleteItem,
  deleteStep,
  updateBlock,
  updateItem,
  updateStep,
  updateSettings,
  addStepAt,
} from "@/app/actions";
import type { Block, Deadline, Item, Step } from "@/lib/types/database";
import type { SnapshotDiff } from "./snapshot";

const SERVER_FIELDS_BLOCK = [
  "name",
  "color",
  "sort_order",
  "collapsed",
] as const;
const SERVER_FIELDS_ITEM = [
  "title",
  "block_id",
  "start_date",
  "duration_days",
  "deadline_offset",
  "deadline_id",
  "color",
  "sort_order",
  "recurrence",
] as const;
const SERVER_FIELDS_STEP = [
  "label",
  "notes",
  "status",
  "day_offset",
  "duration_min",
  "time_of_day",
  "completed_at",
  "detached",
] as const;

function blockCreatePayload(b: Block) {
  return {
    id: b.id,
    // Required by blockCreateSchema. Omitting it made EVERY undo-restore of a
    // deleted block fail Zod server-side — swallowed by `safe()`, so the
    // client showed the restored block while the DB stayed deleted.
    board_id: b.board_id,
    name: b.name,
    color: b.color,
    sort_order: b.sort_order,
    collapsed: b.collapsed,
  };
}

function blockUpdatePayload(b: Block) {
  const out: Record<string, unknown> = {};
  for (const k of SERVER_FIELDS_BLOCK) out[k] = b[k];
  return out;
}

function deadlineCreatePayload(d: Deadline) {
  // board_id is required by deadlineCreateSchema — same undo-of-delete fix as
  // blockCreatePayload.
  return {
    id: d.id,
    board_id: d.board_id,
    name: d.name,
    color: d.color,
    date: d.date,
  };
}

function itemCreatePayload(i: Item, stepsForItem: Step[]) {
  // createItemWithSteps inserts the item + N empty steps with our chosen
  // step ids; we then issue updateStep per non-default step to restore
  // label/time/duration/notes/status. Extra round trips, but cleaner than
  // changing the action signature.
  // Sparse series (recurrence) need their steps recreated at the original
  // offsets, not contiguously — pass them explicitly. Duration covers the
  // last step either way (matches the pre-offsets behavior for contiguous
  // items, where length === maxOffset+1).
  const offsets = stepsForItem.map((s) => s.day_offset);
  return {
    id: i.id,
    // Required by itemCreateSchema — same undo-of-delete fix as
    // blockCreatePayload.
    board_id: i.board_id,
    title: i.title,
    block_id: i.block_id,
    start_date: i.start_date,
    duration_days: offsets.length ? Math.max(...offsets) + 1 : i.duration_days,
    deadline_offset: i.deadline_offset,
    deadline_id: i.deadline_id ?? undefined,
    color: i.color ?? undefined,
    sort_order: i.sort_order,
    recurrence: i.recurrence ?? undefined,
    stepIds: stepsForItem.map((s) => s.id),
    ...(offsets.length ? { stepOffsets: offsets } : {}),
  };
}

function itemUpdatePayload(i: Item) {
  const out: Record<string, unknown> = {};
  for (const k of SERVER_FIELDS_ITEM) out[k] = i[k];
  return out;
}

function stepUpdatePayload(s: Step) {
  const out: Record<string, unknown> = {};
  for (const k of SERVER_FIELDS_STEP) out[k] = s[k];
  return out;
}

function stepHasNonDefaults(s: Step): boolean {
  return (
    s.label.trim() !== "" ||
    s.notes !== null ||
    s.status !== "todo" ||
    s.duration_min !== null ||
    s.time_of_day !== null ||
    s.completed_at !== null ||
    s.detached
  );
}

export async function applyDiff(
  diff: SnapshotDiff,
  targetSteps: Step[],
  targetPinnedItemIds: string[],
): Promise<{ ops: number; errors: number }> {
  let ops = 0;
  let errors = 0;
  const safe = async <T>(p: Promise<T> | undefined) => {
    if (!p) return;
    ops++;
    try {
      await p;
    } catch {
      errors++;
    }
  };

  // ── Creates (parents first) ──
  for (const b of diff.blocks.created)
    await safe(createBlock(blockCreatePayload(b)));
  for (const d of diff.deadlines.created)
    await safe(createDeadline(deadlineCreatePayload(d)));

  // Items + their steps in one shot.
  // Group target steps by item id, but only for items being created here.
  const createdItemIds = new Set(diff.items.created.map((i) => i.id));
  const stepsByItem = new Map<string, Step[]>();
  for (const s of targetSteps) {
    if (!createdItemIds.has(s.item_id)) continue;
    const arr = stepsByItem.get(s.item_id) ?? [];
    arr.push(s);
    stepsByItem.set(s.item_id, arr);
  }
  for (const arr of stepsByItem.values())
    arr.sort((a, b) => a.day_offset - b.day_offset);

  for (const i of diff.items.created) {
    const itemSteps = stepsByItem.get(i.id) ?? [];
    await safe(createItemWithSteps(itemCreatePayload(i, itemSteps)));
    // Restore non-default step fields.
    for (const s of itemSteps) {
      if (stepHasNonDefaults(s)) {
        await safe(updateStep(s.id, stepUpdatePayload(s)));
      }
    }
  }

  // Steps created standalone (parent item was already there).
  for (const s of diff.steps.created) {
    if (createdItemIds.has(s.item_id)) continue; // already handled above
    // Recreate under the SNAPSHOT's id (addStepAt upserts on a provided id).
    // Without it the server minted a fresh id and the follow-up update below
    // targeted the old one — "Step not found", swallowed — so an undone
    // delete restored a BLANK step while the UI showed the labeled/timed one.
    await safe(addStepAt(s.item_id, s.day_offset, s.id));
    if (stepHasNonDefaults(s)) {
      await safe(updateStep(s.id, stepUpdatePayload(s)));
    }
  }

  // ── Updates ──
  // ⚠️ Deliberately unguarded, and it must stay that way.
  //
  // A stale-write guard ("land this only if the row still carries the version I
  // read") is precisely wrong for undo: undo restores a snapshot OVER whatever
  // is current — that is what undo *is* — so the row has moved by definition
  // and every undo would be rejected. No write action in this codebase accepts
  // such a precondition any more, so there is nothing to pass here; this
  // comment and `sync.test.ts`'s arity assertions are what stop one being
  // reintroduced "for consistency" with a future guard.
  for (const b of diff.blocks.updated)
    await safe(updateBlock(b.id, blockUpdatePayload(b)));
  for (const i of diff.items.updated)
    await safe(updateItem(i.id, itemUpdatePayload(i)));
  for (const s of diff.steps.updated)
    await safe(updateStep(s.id, stepUpdatePayload(s)));
  // Deadlines don't have an updateDeadline action; deadlines are
  // create/delete only in the current data model.

  // ── Deletes (children first) ──
  for (const id of diff.steps.deleted) await safe(deleteStep(id));
  for (const id of diff.items.deleted) await safe(deleteItem(id));
  for (const id of diff.blocks.deleted) await safe(deleteBlock(id));
  for (const id of diff.deadlines.deleted) await safe(deleteDeadline(id));

  // ── Settings (pinned items) ──
  if (diff.pinnedChanged) {
    await safe(updateSettings({ pinnedItemIds: targetPinnedItemIds }));
  }

  return { ops, errors };
}
