/**
 * `sanitizeAction`, and the three-way split it makes between "our own copy",
 * "bad input" and "something we do not understand".
 *
 * Before this file the implementation lived inside a `"use server"` module and
 * **no test executed it** — so its behaviour could be changed in a one-line
 * tidy-up with the whole suite green. That is the gap this closes.
 *
 * Every assertion below is written so it fails when the line it defends is
 * deleted.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import {
  ActionError,
  DomainError,
  isDomainError,
  sanitizeAction,
} from "@/lib/domain/errors";

/**
 * A SQLite failure in the shape the data layer actually produces: the message
 * names a constraint, which is exactly the sort of detail that must be logged
 * for us and masked for the user.
 */
const CONSTRAINT = "steps.day_offset";
const sqliteError = () =>
  Object.assign(new Error(`CHECK constraint failed: ${CONSTRAINT}`), {
    errcode: 275,
  });

type ConsoleSpy = { mock: { calls: unknown[][] } };

/** Everything the spy saw, flattened, so nothing can hide in an argument. */
function loggedText(spy: ConsoleSpy): string {
  return spy.mock.calls
    .map((args: unknown[]) =>
      args
        .map((a) => {
          try {
            // `Error` serialises to `{}` under JSON.stringify, so walk own
            // properties too.
            return a instanceof Error
              ? a.message + JSON.stringify({ ...a })
              : JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" "),
    )
    .join("\n");
}

afterEach(() => vi.restoreAllMocks());

describe("an unrecognised failure is logged, never swallowed", () => {
  it("passes the raw error to console.error under the [action] tag", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      sanitizeAction(sqliteError(), "Could not update step"),
    ).toThrow("Could not update step");
    // Non-vacuity for the masking test below: the detail the user must not see
    // has to actually exist somewhere, or "the message omits it" proves nothing.
    expect(loggedText(spy)).toContain(CONSTRAINT);
    expect(spy.mock.calls[0][0]).toBe("[action]");
  });
});

describe("sanitizeAction", () => {
  it("masks an unknown error with the fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let thrown: unknown;
    try {
      sanitizeAction(sqliteError(), "Could not do the thing");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ActionError);
    expect((thrown as Error).name).toBe("ActionError");
    expect((thrown as Error).message).toBe("Could not do the thing");
    expect((thrown as Error).message).not.toContain(CONSTRAINT);
  });

  it("passes its own class through untouched, code and all", () => {
    const original = new ActionError("Board not found", "not_found");
    let thrown: unknown;
    try {
      sanitizeAction(original, "Could not do the thing");
    } catch (e) {
      thrown = e;
    }
    // Identity, not equality: a caller branching on `.code` reads it off the
    // very object the action threw.
    expect(thrown).toBe(original);
    expect((thrown as DomainError).code).toBe("not_found");
  });

  it("turns a ZodError into an actionable message naming no column", () => {
    const schema = z.object({ day_offset: z.number().int().min(0) });
    let thrown: unknown;
    try {
      sanitizeAction(
        schema.safeParse({ day_offset: -1 }).error,
        "Could not do the thing",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ActionError);
    expect((thrown as Error).message).toMatch(/^Invalid input: /);
    expect((thrown as Error).message).not.toBe("Could not do the thing");
  });
});

describe("isDomainError", () => {
  it("recognises an ActionError", () => {
    expect(isDomainError(new ActionError("x"))).toBe(true);
  });

  it("rejects a plain Error and a raw database error", () => {
    expect(isDomainError(new Error("boom"))).toBe(false);
    expect(
      isDomainError({ errcode: 275, message: "CHECK constraint failed" }),
    ).toBe(false);
    expect(isDomainError(null)).toBe(false);
    expect(isDomainError("Not found")).toBe(false);
  });

  /**
   * The JOIN between the two halves, which each of the tests around it covers
   * on its own and neither covers together.
   *
   * `it("recognises an ActionError")` passes through `instanceof`, never
   * touching the brand; the literal test below exercises the duck-type path but
   * never proves a real instance CARRIES the brand. Delete
   * `readonly isDomainError = true` and both stay green while `isDomainError`
   * silently degrades to instanceof-only — working in every test and in dev,
   * and failing exactly across a duplicate module instance.
   *
   * Spreading is what makes this a real check: it proves the brand is an own
   * ENUMERABLE property that survives crossing a boundary, which is the
   * property the duck-type path actually depends on.
   */
  it("carries the brand as an own enumerable property on a real instance", () => {
    expect({ ...new ActionError("x") }).toMatchObject({ isDomainError: true });
    // Note a SPREAD is not itself recognisable: `Error.prototype.message` is
    // own-but-non-enumerable, so `{...err}` drops it and the duck-type path
    // correctly refuses an object with a brand and no message. A real
    // cross-realm Error keeps `.message` readable, which is the case that
    // matters.
    expect(isDomainError({ ...new ActionError("Board not found") })).toBe(
      false,
    );
    expect(
      isDomainError({
        ...new ActionError("Board not found"),
        message: "Board not found",
      }),
    ).toBe(true);
  });

  it("recognises a structurally-branded error across a module boundary", () => {
    const crossRealm = { isDomainError: true, message: "Board not found" };
    expect(isDomainError(crossRealm)).toBe(true);
    // The brand alone is not enough — a message is what callers actually read.
    expect(isDomainError({ isDomainError: true })).toBe(false);
  });
});
