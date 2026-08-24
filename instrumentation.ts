/**
 * Runs once per server process, before the first request is served — Next's
 * own guarantee (`node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`:
 * `register` "will be called once when a new Next.js server instance is
 * initiated, and must complete before the server is ready to handle requests").
 *
 * For a desktop app "a new server process" is exactly "the user launched
 * Weekloom", which is why this is where launch-time work belongs.
 *
 * Two jobs:
 *  1. Open and migrate the database, so a migration failure surfaces as a
 *     startup error rather than as a 500 on the first page render.
 *  2. Extend every recurring series once. ⚠️ This replaces nothing that ran on
 *     a schedule and must not grow into one. Series are stored finite and
 *     something has to extend them; the only reader of a board's steps is the
 *     board, so opening the app IS the event that needs it. This is not a
 *     render, and it is not a timer.
 *
 * ⚠️ It also runs on every dev-server restart. Materialisation is idempotent
 * (it dedups on `origin_day_offset`) and the failure path below is non-fatal,
 * so that is harmless — do not add a guard against it.
 */
export async function register() {
  // ⚠️ `register` is invoked for BOTH the node and edge runtimes. `node:sqlite`
  // exists in neither an edge runtime nor a browser, so without this the edge
  // invocation throws on the import below.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getDb } = await import("@/lib/db/connection");
  const { materializeAll } = await import("@/lib/db/materialize");
  const { toISODate } = await import("@/lib/utils");

  // Creates ~/.weekloom, opens the file, sets the pragmas and runs any pending
  // migration. Deliberately NOT wrapped: a database that cannot be opened is a
  // real startup failure and must be loud.
  getDb();

  try {
    materializeAll(toISODate(new Date()));
  } catch (e) {
    // ⚠️ Logged, never fatal. Extending a series is system growth, not a user
    // edit: an app that refuses to start because one series could not be
    // extended is strictly worse than one that starts, and the next launch
    // runs the same pass.
    console.error("[boot] materialize failed", e);
  }
}
