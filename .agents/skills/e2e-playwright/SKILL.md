---
name: e2e-playwright
description: Test Weekloom end to end by driving the real app headlessly with Playwright against a production build, on a throwaway data directory that never touches the user's ~/.weekloom. Use whenever the user asks to test the app, run the tests, run e2e or integration or browser tests, verify a change works end to end, check that a flow still works, confirm the UI is not broken, or reproduce a bug in the running app.
---

# Testing Weekloom end to end

## When to use this, and when not

**Run both, in this order.** They cover disjoint halves of the codebase and neither substitutes
for the other:

```bash
npm test            # fast (~2s). Covers lib/ and tests/. Catches logic.
npm run test:e2e    # slow (minutes). Covers everything else. Catches the app.
```

`vitest.config.ts` includes the `lib/` and `tests/` trees and nothing else, so **the
`components/` and `electron/` trees are invisible to `npm test`**. A change to
`components/gantt/board.tsx` — the ~6,300-line chart — can be green in vitest and completely
broken in the running application.
Playwright is the only thing that reaches it, along with App Router routing, the Server Action
wire format, the desktop shell and the claim that nothing leaves the machine.

A change confined to `lib/` is genuinely covered by `npm test` alone. Anything a person can see is
not.

## Setup, once

```bash
npx playwright install chromium
```

## Running

```bash
npm run app:build     # ⚠️ FIRST — see below
npm run test:e2e
```

Useful flags:

```bash
npm run test:e2e -- -g "a lane and a task persist"   # one test by title
npm run test:e2e -- e2e/drag.spec.ts                 # one file
npm run test:e2e -- --headed                         # watch it happen
npm run test:e2e -- --debug                          # step through
npm run test:e2e -- --ui                             # the interactive runner
```

⚠️ **`npm run app:build` first, every time.** The suite drives
`.next/standalone/server.js` — the exact artifact the desktop app ships — never `next dev`. A
development build differs in bundling, in Server Action encoding and in `force-dynamic` behaviour,
so a green run against it would prove nothing about what ships. `e2e/serve.mjs` refuses to start
if the build is missing: the run **errors** rather than quietly testing something else.

## ⚠️ Never run this against the user's real data

The suite creates boards, drags bars and deletes blocks. Pointed at a real `~/.weekloom` it would
destroy somebody's planning.

`playwright.config.ts` sets `WEEKLOOM_DATA_DIR` to a throwaway directory under the OS temp
directory, and `e2e/serve.mjs` **refuses any path outside it**. That protection only covers the
harness. **If you start the server by hand, you must set it yourself:**

```bash
WEEKLOOM_DATA_DIR=$(mktemp -d) PORT=4321 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

Running that line without `WEEKLOOM_DATA_DIR` writes straight into the user's real database.

To inspect what a failing test actually wrote:

```bash
sqlite3 "$TMPDIR/weekloom-e2e-data/weekloom.db" \
  "SELECT id, title, start_date, duration_days FROM items ORDER BY created_at;"
```

## The selector protocol

⚠️ **Query the `data-*` attributes. Never a CSS class, and never visible text where an attribute
exists.** These are not test scaffolding — the application's own selection, marquee, keyboard
navigation and pinned-header tracker read the DOM through them, which is what makes them stable:
renaming one breaks a real gesture, so nobody renames one casually.

| attribute                                                | what it marks                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `data-cell-step-id`                                      | one day-cell of a task                                             |
| `data-cell-item-id`, `data-cell-item-bar`                | a task's row and its draggable bar                                 |
| `data-cell-deadline-item-id`                             | a deadline marker cell                                             |
| `data-gantt-sidebar`, `data-gantt-header`                | the chart's sidebar and sticky header band                         |
| `data-step-sidebar`, `data-step-row-id`, `data-item-row` | sidebar rows                                                       |
| `data-block-section`                                     | a lane's section wrapper — the right-click target for lane actions |
| `data-nav-col`, `data-nav-row`                           | keyboard-navigable grid coordinates                                |
| `data-cal-card`, `data-cal-day`, `data-cal-strip`        | week and day view                                                  |
| `data-done-toggle`, `data-resize`, `data-search-flash`   | affordances                                                        |

Shared helpers live in `e2e/helpers.ts` (`openBoard`, `createBlock`, `createItem`, `itemBar`,
`dragBy`, `columnWidth`, `reloadBoard`, `settingControl`, `withWrite`) — start there rather than
re-deriving a selector.

⚠️ **`withWrite(page, act)` is the one to reach for before any reload.** Every Server Action in
this app posts to the same URL, so a bare `page.waitForResponse` also matches a request that was
already in flight from the previous step — it resolves while the write under test has not gone out
at all, and the reload then races the board's 400 ms debounce. `withWrite` records requests at
DISPATCH and waits for the RESPONSE, so neither an in-flight request nor an uncommitted one can
satisfy it.

Buttons with no attribute are reached by `title` or accessible name, which is also what a screen
reader uses: `getByTitle("New block")`, `getByRole("button", { name: "New item" })`.

## The flows the suite covers

| spec                   | flow                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `first-run.spec.ts`    | an empty data directory becomes a database, and `/app` opens straight onto the board list — no login, no landing page, no redirect                                                   |
| `board-crud.spec.ts`   | create a lane → create a task → mark a step done → delete the lane, asserting after each reload                                                                                      |
| `drag.spec.ts`         | drag a bar two columns right, resize its right edge one column, reload, assert both                                                                                                  |
| `recurring.spec.ts`    | create a recurring task, confirm occurrences weeks out, reload, confirm **no duplicates**                                                                                            |
| `undo.spec.ts`         | delete a lane containing tasks → undo → the lane, its tasks and their steps all return, and survive a reload                                                                         |
| `settings.spec.ts`     | two settings persist, and changing one does **not** revert the other                                                                                                                 |
| `archive.spec.ts`      | archive a board → it appears under Trash → restore it → it returns                                                                                                                   |
| `views.spec.ts`        | Gantt, Week, Day and search all open, with no lock and no plan vocabulary anywhere                                                                                                   |
| `no-network.spec.ts`   | every request during a full walk went to `127.0.0.1`                                                                                                                                 |
| `shell.spec.ts`        | the real Electron shell: window on loopback, `crypto.randomUUID` works, Edit menu present, second instance refused                                                                   |
| `routes.spec.ts`       | `/api/health` answers 200, a bogus path 404s, `/` lands on the picker, and a stale board id falls back rather than crashing                                                          |
| `ui-state.spec.ts`     | a collapsed task, and the last-used lane, come back out of SQLite — including a value changed and changed BACK in one page life, and a change left behind INSIDE the 400 ms debounce |
| `ui-chip-mode.spec.ts` | the T/E chip: both modes render, Shift+T / Shift+E persist, and a lane's stored choice outranks the Settings default                                                                 |
| `ui-escape.spec.ts`    | Escape reaches the board (it clears the copy outline) and a dropdown inside a modal closes itself first, its modal second                                                            |
| `ui-picker.spec.ts`    | the board picker draws the stored accent, opens in the stored theme with the cache CLEARED, and its own toggle writes the row                                                        |

⚠️ **That table is the whole suite, and it is checked by set difference rather than by count.**
`ls e2e/*.spec.ts` is 15 files and 15 rows appear above. A count would let a missing row and a
wrong row cancel out; keep the two sets equal when you add a spec, or this table quietly starts
claiming the suite covers less than it does.

## Writing a new spec

Start from `e2e/board-crud.spec.ts`. Four rules:

1. ⚠️ **Assert persisted state by RELOADING, never by reading what the interface just rendered.**
   An optimistic update paints instantly whether or not the write reached SQLite. A board whose
   persistence is broken looks perfect until somebody restarts the app — reloading is the only
   assertion that can tell the two apart.
2. **Use `data-*` selectors** (above).
3. **Every spec creates its own board or leaves the database usable for the next one.** The suite
   is `workers: 1, fullyParallel: false` against one file, so state carries between specs by
   design; a spec that leaves a modal open breaks the next one.
4. **Give every absence assertion a positive control.** `expect(x).toHaveCount(0)` passes when the
   page failed to load at all. Assert something that IS present first, in the same test.

## Proving the app is offline

`e2e/no-network.spec.ts` attaches `page.on("request", …)` over a full walk and asserts every
request host was `127.0.0.1`. **This is the only place that claim is checkable at runtime** — the
build-time and source-level enforcements cannot see the browser.

It carries its own positive control: a second test asserts the same listener DOES record the
loopback traffic (more than five requests). An empty external list means something only if that
control passed — otherwise "no external requests" and "the listener never fired" look identical.

## Reading a failure

```bash
npx playwright show-report            # playwright-report/, opened in a browser
npx playwright show-trace test-results/<...>/trace.zip
```

`trace: "retain-on-failure"` and `screenshot: "only-on-failure"` are configured, so a failed test
already has a full timeline with DOM snapshots at every step. Read the trace before changing a
selector — most "flaky selector" failures are the application genuinely not doing the thing.

## What this cannot cover

- ⚠️ **Native menus.** Playwright's synthetic keyboard events do not dispatch through a macOS
  application menu, so whether ⌘C / ⌘V / ⌘Z reach the board's own handlers or are swallowed by the
  Edit menu roles **must be checked by hand on macOS**. `electron/menu.ts` records the two
  pre-authorised fixes if they conflict.
- **The packaged installer.** `shell.spec.ts` launches the development shell; a packaged build
  resolves `server.js` from a different path. Install and launch a `release/` artifact by hand.
- **OS-level permission prompts**, such as the browser notification grant.
