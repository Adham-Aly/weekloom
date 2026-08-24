/**
 * One error vocabulary and one `sanitize`, shared by `app/actions.ts` and by
 * every domain function it delegates to.
 *
 * ## Why this lives in `lib/` and not in `app/`
 *
 * `app/actions.ts` is a `"use server"` module, and such a module may only
 * export async functions — so it can never export the error class its own
 * callers need to recognise. When `updateStep` / `updateItem` / `applyItemMove`
 * moved into `lib/domain/*`, a domain function throwing its own private class
 * would not have been recognised by the action's `instanceof` check, and
 * `sanitize` would have masked a message that was always meant to reach the
 * user. There is one definition of each, here.
 *
 * ## `sanitize` logs the raw error, and that is deliberate
 *
 * Everything this app talks to is a local SQLite file, so a raw error is a
 * constraint name or a bound-parameter complaint — diagnostic, not sensitive.
 * It is logged so a failure is never silent, and `errors.test.ts` pins that it
 * is: an assertion that "nothing sensitive is logged" would pass trivially on a
 * `sanitize` that logged nothing at all.
 */
import { z } from "zod";
import { DbMissingRowError } from "@/lib/db/errors";

/**
 * Base class for "this message is safe to show the caller".
 *
 * `code` is a structured marker for callers that need to branch on the *kind*
 * of failure rather than on its text. Message text cannot be used for that: a
 * thrown message is redacted by React's flight serializer in production, which
 * emits `{digest}` and nothing else, so anything matching on `message` across
 * the server/client boundary is matching on a string that never arrives.
 */
export class DomainError extends Error {
  /**
   * Structural brand. `instanceof` is the primary check, but it is defeated by
   * duplicate module instances — two copies of this file in one process
   * compare unequal — so a consumer that receives an error across a module
   * boundary it does not control has a second, structural way to ask.
   */
  readonly isDomainError = true as const;

  constructor(
    message: string,
    name: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = name;
  }
}

/** Errors safe to surface from `app/actions.ts` and `lib/domain/*`. */
export class ActionError extends DomainError {
  constructor(message: string, code?: string) {
    super(message, "ActionError", code);
  }
}

/**
 * Is this a deliberately-authored, user-safe message rather than a masked
 * internal failure?
 *
 * A `DomainError`'s message is our own copy and may be shown verbatim;
 * anything else has already been replaced by `sanitize` with a generic
 * fallback *precisely because* the original leaked schema details, and must
 * never be reconstructed.
 */
export function isDomainError(err: unknown): err is DomainError {
  if (err instanceof DomainError) return true;
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { isDomainError?: unknown; message?: unknown };
  if (typeof candidate.message !== "string") return false;
  return candidate.isDomainError === true;
}

/**
 * Explicitly annotated, and the annotation is load-bearing: TypeScript only
 * treats a call as terminating control flow when the callee has an *explicit*
 * `never` return type at its declaration. Without this alias the inferred type
 * is identical but the compiler stops believing `sanitize(e, "…")` ends the
 * function, and every caller needs an unreachable `return` to compile.
 */
export type Sanitizer = (err: unknown, fallback: string) => never;

/**
 * Behaviour, in order:
 *  1. An `ActionError` passes through untouched — it is our copy and the
 *     caller is meant to read it.
 *  2. A `ZodError` becomes `Invalid input: <first issue>` — actionable, and it
 *     names no column or constraint.
 *  3. Everything else is logged server-side and replaced with `fallback`. A
 *     raw SQLite error leaks column names and constraint identifiers into the
 *     UI, which is noise to the user and a maintenance hazard to us.
 */
export const sanitizeAction: Sanitizer = function sanitize(
  err: unknown,
  fallback: string,
): never {
  if (err instanceof ActionError) throw err;
  if (err instanceof z.ZodError) {
    throw new ActionError(
      `Invalid input: ${err.issues[0]?.message ?? "bad request"}`,
    );
  }
  console.error("[action]", fallback, err);
  throw new ActionError(fallback);
};

/**
 * Run a data-layer read whose only interesting failure is "no such row", and
 * give that case the action's own wording.
 *
 * The tempting one-liner — a bare `catch` that throws the message — swallows a
 * genuine data-layer fault and reports it as a missing row, which is a lie
 * about the cause. Anything that is not a {@link DbMissingRowError} is
 * re-thrown for {@link sanitizeAction} to log and mask.
 *
 * It lives here rather than beside the repositories because it is a
 * translation between two error vocabularies, and this module owns the one
 * that reaches the user.
 */
export function requireRow<T>(read: () => T, message: string): T {
  try {
    return read();
  } catch (e) {
    if (e instanceof DbMissingRowError) throw new ActionError(message);
    throw e;
  }
}
