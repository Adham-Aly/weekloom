/**
 * The two failure classes the data layer distinguishes, and why there are
 * exactly two.
 *
 * One error class for both "a row is gone" and "your input is
 * self-contradictory" is what turns a detected failure into a silent loss: a
 * drag whose step had vanished gets reported with the *concurrency* meaning,
 * the caller never checks for a rejection it did not ask for, and the write is
 * retired as a success. MEASURED, which is why there are two.
 *
 * So: a missing row and a malformed request are different answers, and callers
 * that catch one must not accidentally catch the other.
 */

/**
 * The row this operation names does not exist, or no longer belongs where the
 * caller said it did. The state of the world moved; the request was well-formed.
 *
 * `lib/domain/*` turns this into a user-facing `ActionError`. A throw is
 * visible; a discarded return value is not.
 */
export class DbMissingRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbMissingRowError";
  }
}

/**
 * The request itself is impossible to satisfy — two conflicting instructions for
 * one row, an entry with no id, steps from two different items in one swap.
 *
 * ⚠️ **This is deliberately NOT a missing row.** The bug it exists to keep
 * visible: a set-based update that silently applies one of two duplicate source
 * rows returns a matched count one short of the supplied count, so the function
 * reports a *conflict* — and the caller then tells the person their task
 * changed underneath them when nothing changed at all. Deduping instead would
 * hide the ambiguity (two offsets for one step, silently picking one). Raise,
 * distinctly.
 */
export class DbInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbInvalidInputError";
  }
}
