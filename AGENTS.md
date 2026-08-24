# AGENTS.md

Guidance for AI agents working in this repository.

⚠️ **This file is capped at 250 lines and is maintained ZERO-SUM.** See **Maintenance** at the
bottom before you add anything to it. Detail that has a detectable trigger lives in a skill under
`.agents/skills/`, not here — the table near the end says which.

## Project

**Weekloom** is a Gantt-chart planner that runs as a desktop application. It is open source, it
has no accounts and it makes no network requests: everything a person plans lives in one SQLite
file in their own home directory.

The model is four levels deep, and the vocabulary is used consistently everywhere in the code:

```
board   a plan (a project, a term, a household)   → boards
block   a lane within a board                     → blocks
item    a task, which sits in a lane              → items
step    one day of a task, checked off as you go  → steps
```

Plus `deadlines` (a dated marker on a board) and one row of `user_settings`.

## Commands

- `npm run dev` — development server on `http://localhost:3000`; open `/app`
- `npm run build` — production build (`next build`, `output: "standalone"`)
- `npm run build:electron` — compile the desktop main process
- `npm run prepare:standalone` — copy `public/` and `.next/static` beside the built server
- `npm run app:build` — the three above, in order · `app:start` — then launch · `package` — installer
- `npm run typecheck` — **two** projects: `tsc --noEmit && tsc -p tsconfig.electron.json --noEmit`
- `npm test` — `vitest run` · `npm run test:e2e` — Playwright against a real production build
- `npm run lint` · `npm run format` / `format:check`

Node **24 or newer**. The floor is not arbitrary: the data layer uses Node's built-in `node:sqlite`,
so an older runtime advertises a version of this application that cannot open its own database.

**The gate expectations.** `npm run typecheck` → **0 errors**. `npm run lint` → **0 errors**
(pre-existing warnings excepted). `npm test` → all green with **0 skipped**. A skipped test is a
check that cannot distinguish "passed" from "did not run", so zero is the standard rather than an
accident.

Run typecheck, lint and tests before committing. Run `npm run test:e2e` before committing anything
under `components/**` or `electron/**` — see **Testing**.

## Stack

Next 16 canary (App Router, `output: "standalone"`) · React 19 · TypeScript 5 · Electron 43 ·
`node:sqlite` · Tailwind CSS 4 · Vitest 4 · Playwright · Zod · framer-motion · date-fns.

Runtime dependencies are deliberately few, and `tests/no-cloud-imports.test.ts` **enumerates** them
rather than blocklisting: adding one fails that test until somebody adds it to the list on purpose.

⚠️ **`node:sqlite` is the one upgrade-sensitive dependency.** It is still a stability-1
(experimental) API on Node 24, so the data layer uses only its small stable core — `DatabaseSync`,
`prepare`, `run`, `get`, `all`, `exec` — and nothing from `Session` or `backup`.

## Architecture

- **App Router under `app/`.** Server Components load data; Server Actions (`app/actions.ts`)
  mutate; client components live under `components/`.
- **There are five routes and that is all**: `/`, `/app/[[...slug]]`, `/settings`, `/api/health`
  and the not-found page. There is no application-level proxy or middleware file.
- **`app/actions.ts` is the real interface between the two halves.** `components/gantt/board.tsx`
  imports 18 of its functions and `lib/undo/sync.ts` imports 12. Keeping those names and parameter
  lists stable is what keeps the board's 30 write call sites compiling.
- **Everything that touches the database goes through `lib/db/`**, and nothing else may import
  `node:sqlite` — an eslint rule enforces it.

### How a launch works

```
electron/main.ts
  requestSingleInstanceLock()             one instance, one writer
  mkdir ~/.weekloom (0700)
  choosePort()                            ~/.weekloom/port if still free, else listen(0)
  spawn(process.execPath, [server.js])    ELECTRON_RUN_AS_NODE=1, PORT, HOSTNAME=127.0.0.1
  poll GET /api/health every 100ms        up to 30s; retry on a fresh port up to 3 times
  new BrowserWindow(...).loadURL(         sandbox, contextIsolation, no nodeIntegration,
    "http://127.0.0.1:<port>/app")        no preload script
```

`instrumentation.ts` runs inside that server process before it serves anything: it opens and
migrates the database and extends every recurring series once. `ELECTRON_RUN_AS_NODE=1` makes
Electron's binary behave as plain Node — why a release needs nothing installed, and why the
database driver has to be whatever Electron bundles.

### ⚠️ Why the renderer is on `http://127.0.0.1` and never `file://`

`board.tsx` mints ids with `crypto.randomUUID` and copies with `navigator.clipboard`. **Both are
secure-context-only.** An Electron renderer on `file://` is not a secure context, so both are
`undefined` and the board throws the first time somebody creates a task. `http://127.0.0.1` **is** a
secure context, by the loopback exception. `tests/electron-shell-safety.test.ts` pins that
`main.ts` calls `loadURL` on a loopback address and contains no `file://` and no `loadFile(`;
`e2e/shell.spec.ts` evaluates `window.crypto.randomUUID()` inside the real window.

### ⚠️ Why `HOSTNAME=127.0.0.1` is passed to the server child

Next's standalone template is `process.env.HOSTNAME || '0.0.0.0'`. Without that line the server
binds **every interface** and serves the entire local database to anyone on the same network —
successfully, silently, with nothing in the interface suggesting it. MEASURED: with it set,
`lsof -nP -iTCP:<port> -sTCP:LISTEN` reports `TCP 127.0.0.1:<port> (LISTEN)`.
`tests/electron-shell-safety.test.ts` pins both directions.

**The rest of the security posture, so it is not relitigated.** Loopback makes the server
unreachable from another machine; Next's Server Actions compare `Origin` against `Host`, which
defends against a page in the person's ordinary browser POSTing at the port; and
`requestSingleInstanceLock()` prevents a second server and a second writer. **No token or auth
layer is added, deliberately:** any local process running as this user can already open the
database file directly, so an HTTP token would grant no privilege it does not already have.

### ⚠️ The no-network rule

_Nothing leaves the machine_ is the product, not a configuration of it, and it has **three**
enforcement points. Adding an outbound request means changing all three, which is the point:

1. **Build time** — `next/font` self-hosts every face, so no font is fetched at runtime.
2. **Run time** — `next.config.ts`'s CSP names no external origin; `connect-src 'self'` blocks an
   accidental fetch rather than letting it succeed quietly.
3. **Test time** — `tests/no-cloud-imports.test.ts` refuses a third-party specifier, a third-party
   hostname and any external origin in that policy; `e2e/no-network.spec.ts` walks the running
   application asserting every request went to `127.0.0.1`, with its own positive control.

⚠️ **Weekloom runs no inference and holds no model-provider credential.** The most private thing
here is everything the user is planning to do, and an AI integration is the cheapest way to send it
somewhere — it does not look like a network feature, it looks like a summarize button.
`tests/no-ai-provider.test.ts` pins the manifest, the import specifiers and the inference
hostnames. A failure there means "either this is a deliberate change of what Weekloom is, and the
README and that test change with it — or undo it."

### The write path

```
recordSnapshot()  →  setState(optimistic)  →  persist(() => serverAction(...))
```

**In that order, always.** The snapshot must precede the state change or undo restores the
post-change state — which looks like undo doing nothing.

- **`persist()` is the single write chokepoint** (`board.tsx`, the `persist` `useCallback`), called
  from **30** sites: a `startTransition` around the call with a `.catch` that logs.
- ⚠️ **Accepted consequence:** a write that throws is logged and the optimistic state is **not**
  rolled back, so the interface can diverge from disk until the next navigation re-reads it. A
  local SQLite write fails only on a real bug or a full disk, and the alternative — a permanently
  green "saved" indicator — is a lie by omission. That is why there is no write-status indicator.
- ⚠️ **Client-minted UUIDs are the identity contract.** Server-generated ids would make the
  optimistic row and the persisted row two different rows.

## Data: `~/.weekloom`

One directory, created mode `0700` on first launch, holding one SQLite file. There is no other
persistent state anywhere — no cache directory, no preferences plist, no log file.

`lib/db/connection.ts` decides the location:
`process.env.WEEKLOOM_DATA_DIR ?? path.join(os.homedir(), ".weekloom")`.
⚠️ **`os.homedir()`, never `process.cwd()`** — the standalone server `chdir()`s into its own
directory before serving, and inside a packaged application the working directory is not the
application root either. The home directory is the only anchor true in all three runtimes.
`WEEKLOOM_DATA_DIR` exists **for tests and the Playwright harness only**.

### Access control

**There is none, and that is the design.** One person, one process, one file. Standing in for a
database's permission system: the OS file mode `0700`; the loopback bind and Next's Origin/Host
check; the eslint rule keeping the database handle inside `lib/db/`; and **the Zod allowlists at
every action input**, which bound `day_offset`, `time_of_day` and `duration_days` to real ranges
and **strip server-set fields** — never widen one.

## Testing

**Vitest runs in a node environment over the `lib/` and `tests/` trees only.**

⚠️ **`components/` and `electron/` are invisible to `npm test`.** A change to the ~6,300-line board
or to the desktop shell can be green in vitest and broken in the application. So: **pure logic
belongs in `lib/`** — that is why `lib/gantt/layout.ts`, `lib/calendar/overlap-layout.ts` and
`lib/notifications/compute.ts` exist separately from their consumers — and behaviour that must stay
ABSENT from a component is pinned by a source-scan test.

**Playwright (`e2e/`) is the only layer that reaches `components/**`, `electron/**`, App Router
routing, the Server Action wire format and the no-network claim.** It drives the real production
standalone build, never `next dev`, on a throwaway `WEEKLOOM_DATA_DIR` under the OS temp directory.
⚠️ **Assert persisted state by RELOADING**, never by reading what the interface just rendered.

## Conventions a change must match to look native

- **Server Action shape**: `"use server"` → imports → a module-level Zod schema per input →
  `export async function name()` → `try { parse → write → return } catch (e) { sanitizeAction(e,
"Could not …") }`. Every user-facing error string starts `"Could not "`, and `sanitizeAction`
  has an explicit `never` return so a caller cannot forget that it throws.
- **Zod at every input boundary, as an allowlist that STRIPS server-set fields.**
- **Comments carry the reason and the counter-argument**, not the description. `⚠️` prefixes a
  load-bearing invariant, with a nearby paragraph naming the failure it prevents and what was
  measured. **A terse comment reads as foreign here.**
- Files are `kebab-case.ts`; unit tests are colocated in `lib/`, cross-cutting ones in `tests/`.
  `npm run format` enforces the rest. Component style rules live in the `weekloom-ui` skill.
- ⚠️ **`data-*` attributes are the DOM query protocol**, not styling hooks — the application's own
  selection, marquee and keyboard navigation read them. Renaming one silently breaks a gesture.

## Where the detail lives

Each is a skill under `.agents/skills/`, loaded on its trigger. **Read the relevant one before
working in that area** rather than inferring the rules from the code.

| skill                      | read it when                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sqlite-data-layer`        | changing the schema, writing a migration, anything under `lib/db/`, a binding or cascade bug            |
| `recurring-series`         | recurrence, `materializeSeries`, `applyItemMove`, `origin_day_offset`, duplicated or frozen occurrences |
| `settings-and-persistence` | adding or removing a settings key, `updateSettings`, the debounced auto-save, `localStorage`            |
| `weekloom-ui`              | any component work — styling, popovers, the Escape stack, drags, skeletons, the T/E chip                |
| `guard-tests`              | writing or editing anything under `tests/`, or when a guard test fails                                  |
| `build-electron-app`       | building, packaging, producing an installer, or verifying one actually starts                           |
| `e2e-playwright`           | running or writing end-to-end tests                                                                     |

## Maintenance

**Keep this file current**, and keep it **at or under 250 lines**.

⚠️ **Maintenance here is ZERO-SUM.** The line budget is the point, not an accident: a file nobody
finishes reading is a file that does not guide anything. So the test for whether something belongs
in `AGENTS.md` is not "is this true and useful" — almost everything is — it is:

> **Is this worth removing something else to make room for?**

If the answer is no, it does not go here. If the answer is yes, name what you are cutting and cut
it in the same change. Only when there is genuinely spare room may you add without removing.

Three questions settle most cases:

1. **Does it have a detectable trigger?** ("when touching migrations", "when styling a component")
   → it belongs in a **skill**, where it loads exactly when it is needed and costs nothing when it
   is not. This is the default answer; prefer it.
2. **Is it broad and unconditional** — something every change in this repository must respect
   regardless of what it touches? → it belongs **here**.
3. **Otherwise** → it is bloat. Delete it, or leave it as a comment beside the code it describes,
   which is where a narrow fact stays honest for longest.

⚠️ **Cite `components/gantt/board.tsx` by SYMBOL, not by line number.** It is ~6,300 lines and every
edit moves everything below it, so line citations rot within a change or two and then actively
mislead. `the persist chokepoint`, `the bar-drag handler` — those stay true.

`CLAUDE.md` is a one-line include of this file.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions and file structure may all differ from what
you remember. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code,
and heed deprecation notices. This application has **no middleware and no proxy file at all**:
there is nothing to authenticate and nothing to redirect.
