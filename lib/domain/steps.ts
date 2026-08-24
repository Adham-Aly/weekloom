/**
 * Step writes.
 *
 * `app/actions.ts` re-exports this as a Server Action; there is one
 * implementation. It lives here rather than inline in that module for one
 * concrete reason: `vitest.config.ts` collects `lib/**` and `tests/**` only, so
 * anything written inside `app/` is invisible to `npm test`.
 */
import { stepUpdateSchema, uuidSchema } from "@/lib/actions/schemas";
import { ActionError, sanitizeAction as sanitize } from "@/lib/domain/errors";
import { updateStepRow } from "@/lib/db/steps";

/**
 * Patch one step and return the LANDED row.
 *
 * ⚠️ Returning the row is not a convenience: `board.tsx` reconciles its
 * optimistic state against what actually landed, so returning `void` here
 * would leave the client believing its own guess.
 *
 * There is deliberately no version / expectation parameter. See
 * `lib/actions/schemas.ts`'s note above `applyItemMoveSchema`: one process owns
 * the database file, so every rejection such a guard produced would be false.
 */
export async function updateStep(id: string, patch: unknown) {
  try {
    const stepId = uuidSchema.parse(id);
    const fields = stepUpdateSchema.parse(patch);
    if (Object.keys(fields).length === 0) return null;
    const step = updateStepRow(stepId, fields);
    if (!step) throw new ActionError("Step not found");
    return step;
  } catch (e) {
    sanitize(e, "Could not update step");
  }
}
