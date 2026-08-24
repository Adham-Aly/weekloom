/**
 * Item writes: the ordinary field patch, and the atomic multi-step move the
 * Gantt's drag/shift gestures commit on release.
 *
 * `app/actions.ts` re-exports both as Server Actions; there is one
 * implementation of each. They live here rather than inline in that module for
 * one concrete reason: `vitest.config.ts` collects `lib/**` and `tests/**`
 * only, so anything written inside `app/` is invisible to `npm test`.
 */
import {
  applyItemMoveSchema,
  type ApplyItemMoveInput,
  itemUpdateSchema,
  uuidSchema,
} from "@/lib/actions/schemas";
import {
  ActionError,
  requireRow,
  sanitizeAction as sanitize,
} from "@/lib/domain/errors";
import { blockBoardId } from "@/lib/db/blocks";
import { itemBoardId, updateItemRow } from "@/lib/db/items";
import { DbMissingRowError } from "@/lib/db/errors";
import { applyItemMove as dbApplyItemMove } from "@/lib/db/rpc/apply-item-move";

export async function updateItem(id: string, patch: unknown) {
  try {
    const itemId = uuidSchema.parse(id);
    const fields = itemUpdateSchema.parse(patch);
    if (Object.keys(fields).length === 0) return;
    // Two existence checks with two different messages. `updateItemRow`
    // returning null cannot tell "no such item" from "no such destination
    // block", and reparenting an item into a block that does not exist would
    // otherwise leave a row rendering in no lane at all.
    requireRow(() => itemBoardId(itemId), "Item not found");
    const destination = fields.block_id;
    if (destination)
      requireRow(() => blockBoardId(destination), "Block not found");
    const item = updateItemRow(itemId, fields);
    // ⚠️ The LANDED row, not `void`: `board.tsx` reconciles its optimistic
    // state against what actually landed.
    if (!item) throw new ActionError("Item not found");
    return item;
  } catch (e) {
    sanitize(e, "Could not update item");
  }
}

/**
 * Apply a step-by-step `day_offset` update map plus optional item start_date /
 * duration_days / deadline_offset adjustments in one round trip. Used by the
 * Gantt's selection shifts so auto-grow and auto-shift-start land atomically.
 *
 * ⚠️ `ruleDelta` is required by design and cannot be derived here: a scope-all
 * weekday rotation and a user arrow-shifting one cell arrive in the IDENTICAL
 * shape and need OPPOSITE `origin_day_offset` behaviour. There is no `?? 0`
 * anywhere on this path — see `lib/actions/schemas.ts`'s docstring on the
 * field, and `lib/db/rpc/apply-item-move.ts` for what it does with it.
 */
export async function applyItemMove(input: ApplyItemMoveInput) {
  try {
    const parsed = applyItemMoveSchema.parse(input);
    // The move itself raises the same error class for a missing item and for a
    // step that no longer belongs to one, so the item is checked here to keep
    // the two messages apart. Both calls are synchronous with no await between
    // them, so nothing can land in the gap.
    requireRow(() => itemBoardId(parsed.itemId), "Item not found");
    try {
      dbApplyItemMove({
        itemId: parsed.itemId,
        stepUpdates: parsed.stepUpdates,
        newStartDate: parsed.newStartDate ?? null,
        newDuration: parsed.newDuration ?? null,
        newDeadlineOffset: parsed.newDeadlineOffset ?? null,
        // Required at the schema, so there is no `?? 0` here: a missing value
        // is a compile error at the call site, not a silent freeze.
        ruleDelta: parsed.ruleDelta,
      });
    } catch (e) {
      // A step vanished or was reparented mid-gesture. The move applied
      // nothing — it is one transaction — so this must surface as a failure
      // rather than as a silent partial apply.
      if (e instanceof DbMissingRowError) {
        throw new ActionError("Step does not belong to item");
      }
      throw e;
    }
  } catch (e) {
    sanitize(e, "Could not move item");
  }
}
