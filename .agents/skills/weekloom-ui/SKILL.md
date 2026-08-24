---
name: weekloom-ui
description: Write or change a Weekloom component so it looks and behaves native to the codebase — the Tailwind token scale, framer-motion entrances, popover and dismissal idioms, the data-* DOM query protocol, the shared Escape stack, the two deliberately different drag idioms, route skeletons and the T/E chip. Use when editing anything under components/, adding a modal, popover, menu or dropdown, styling anything, or debugging a gesture that silently stopped responding.
---

# Working in `components/`

⚠️ **`components/**`is invisible to`npm test`** (`vitest.config.ts`covers`lib/`and`tests/`only). Two consequences: **new pure logic goes in`lib/`**, not in the component — that is why
`lib/gantt/layout.ts`, `lib/calendar/overlap-layout.ts`and`lib/notifications/compute.ts`exist
separately from their consumers — and anything user-visible must be verified through`npm run test:e2e`(see the`e2e-playwright` skill), never by reading the code.

## Looking native

- **Client Components by default.** Props are **inline type literals**, not named interfaces.
  `cn()` from `@/lib/utils` for conditional classes.
- **Tailwind 4 with `[data-theme]` design tokens** — `bg-bg-elev`, `text-text-muted`,
  `var(--accent)`. Font sizes are bracket literals and oddly precise (`text-[11.7px]`,
  `text-[9.9px]`) because the root font size is 90%. ⚠️ **Match the existing scale; do not
  introduce `text-sm`.**
- **framer-motion for every entrance**, `duration: 0.12, ease: [0.16, 1, 0.3, 1]`.
- **Popovers portal to `document.body`** behind a `mounted` state. Dismissal is always
  `useOutsideClick` + `useEscape` **as a pair**.
- **Errors**: optimistic rollback plus `console.error("[scope] …", e)`. **Never a toast.**
- **Comments carry the reason and the counter-argument**, not the description. `⚠️` prefixes a
  load-bearing invariant, with a nearby paragraph naming the failure it prevents and what was
  measured. A terse comment reads as foreign here.
- 80 columns, double quotes, semicolons, trailing commas; files are `kebab-case.ts`.
  ⚠️ A number of files are deliberately non-conforming, inherited from the initial commit
  (`npx prettier --check .` names them; do not treat that list as a target). **Format only the
  files you edited** — `prettier --write` across the tree produces an 898-line reformat of
  `board.tsx` alone. To prove you added no formatting debt to a non-conforming file you touched,
  diff `prettier(HEAD version)` against `prettier(your version)`: the difference should be exactly
  your semantic change.

## ⚠️ The `data-*` DOM query protocol

These are not styling hooks and not test scaffolding. The application's own selection, marquee,
keyboard navigation and pinned-header tracker query the DOM through them:

| family                                                                                       | what reads it                                       |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `data-cell-step-id`, `data-cell-item-id`, `data-cell-item-bar`, `data-cell-deadline-item-id` | cell selection, marquee, copy/paste                 |
| `data-nav-col`, `data-nav-row`, `data-item-row`, `data-step-row-id`                          | keyboard navigation                                 |
| `data-gantt-sidebar`, `data-gantt-header`, `data-step-sidebar`, `data-block-section`         | the sticky band and the pinned block-header tracker |
| `data-cal-card`, `data-cal-day`, `data-cal-strip`                                            | calendar hit-testing                                |
| `data-search-flash`, `data-step-copied`, `data-done-toggle`, `data-resize`                   | transient affordances                               |

**Renaming one silently breaks a gesture** — nothing throws, the feature simply stops responding.
They are also every Playwright spec's selectors, which turns a rename from silent into a red test.
Query them; never a CSS class, and never visible text where an attribute exists. Several are
applied to **many** nodes, so a bare `toBeVisible()` on one is a strict-mode violation — scope it.

⚠️ **`data-setting-row` is the exception that proves the rule.** Nothing in the application reads
it; it exists purely so `e2e/settings.spec.ts` can reach a control, because `Row` renders its label
and control as siblings with no `for`/`id` pair. A selector written against a Tailwind utility
keeps matching until somebody restyles the grid, then stops **silently**. Prefer one honest
attribute to a clever selector.

## ⚠️ The shared Escape stack — a closed dismissable must not sit on it

`lib/hooks/use-escape.ts` runs one capture-phase window listener that `stopPropagation()`s whenever
the stack is non-empty — deliberately, so the board's own bubble-phase keydown stays quiet while a
modal is open. The consequence: any always-mounted control that registers **unconditionally**
swallows Escape for everything underneath it, silently.

Three did — `ViewMenu`, the unscheduled tray's date picker, and `BlockSelect`. MEASURED: a
capture-phase probe on `document` recorded **no keydown at all** reaching the board, so a cell
selection could not be cleared, the copy outline could not be dismissed and day-focus could not be
exited.

⚠️ **Always pass the hook's second argument** — `useEscape(fn, open)` — unless the component is
only ever MOUNTED while open (`TimePopover`, `ContextMenu`, `EventEditPopover` and the calendar's
quick-create card are, and are correct as they stand). It also fixes nesting: a stack entry's
position is fixed at registration and effects run child-first, so a dropdown that registered at
mount was pinned BELOW its own modal. `e2e/ui-escape.spec.ts` pins both directions.

## ⚠️ Two drag idioms, deliberately not unified

- `lib/hooks/use-resize-drag.ts` **never re-renders mid-drag**: it drives the whole gesture through
  a ref plus direct DOM mutation, and its `cleanup()` holds the single commit.
- The board's **bar drag deliberately does use React state** mid-gesture.

Both obey the same contract — `start*` / `move*` / `end*`, where `move*` touches client state only
and `end*` makes the one server call. **Every drag commits on RELEASE.** Do not unify the two.

## ⚠️ Calendar scroll behaviour is load-bearing

- `calendar.tsx`'s week panning depends on `overflowAnchor: "none"` and on `centreScroll` disabling
  scroll-snap across the write. Without them every Today / next-week click is committed straight
  back and the panel appears frozen.
- The scroll-pinned block header writes transforms **synchronously in a scroll listener, not in
  rAF**. An rAF hop puts the two halves one frame apart and the header visibly lags the grid. Do
  not "optimise the scroll handler".

These govern the _horizontal_ pan window and the Gantt header specifically — not every line in the
file.

## Route skeletons

Two `loading.tsx` boundaries (`app/app/[[...slug]]`, `app/settings`) fill the gap where a Server
Component `await`s. The primitive is `components/ui/skeleton.tsx`; `SkeletonScreen` owns
`role="status"`, `aria-busy` and one `sr-only` label so a screen reader hears one message.

- **Deliberately absent from `/`**, whose page function is not `async` and never suspends.
- ⚠️ `app/app/[[...slug]]/loading.tsx` is a Client Component on purpose: one segment serves two
  surfaces and **a `loading.tsx` receives no props**, so it recovers the destination from
  `usePathname()` and **mirrors `parseSlug` in `page.tsx`**. Change that parser and change this.
- **Geometry is imported, not retyped** (`SIDEBAR_W`, `DATE_ROW_H`, … from `lib/gantt/constants`).
- ⚠️ **No `Math.random()`** — these render on the server first, so a randomised layout hydrates to
  a different one. `.wl-skeleton` carries the repository's **only** `prefers-reduced-motion` opt-out.

## The T/E chip

Every step row draws one chip: the step's **time of day** (`T`) or an **effort estimate in
minutes** (`E`, an inline input writing `steps.duration_min`).

```
board.tsx    →  chipMode = chipModeByBlock[block.id] ?? settings.defaultChipMode
step-row.tsx →  "T" ? <TimeChip/> : <input data-nav-col="effort"/>
```

- **Shift+T / Shift+E stamp every lane currently on the board** into `chipModeByBlock`, so they are
  a per-lane override, not a global switch. `defaultChipMode` governs only a lane with **no entry**.
- ⚠️ **Never seed `chipModeByBlock` with an entry per lane at load.** The absence of a key is what
  keeps a later change of the default effective for lanes made afterwards.
- ⚠️ **Do not put a literal back at that call site.** It was one — `chipMode="T"` — and the whole
  feature was inert behind it: the map persisted, the shortcuts fired, the Settings control saved,
  and the render never looked. Nothing threw and no test went red, because nothing tested the
  render. `e2e/ui-chip-mode.spec.ts` asserts across a **reload**.
- The `E` input shares the keyboard grid with the label (`data-nav-col="effort"`). In `T` mode
  those cells do not exist and `focusSiblingCol(id, "effort")` is a no-op — correct, not a bug.
- ⚠️ **Effort is clamped at 1440** in every writer. `stepUpdateSchema` caps `duration_min` there and
  `persist()` logs a rejected write **without rolling back**, so an unclamped value fails
  invisibly: MEASURED, typing `2000` returned HTTP 500, left `2000` on screen, and gave back the
  old value after a relaunch.

## The write chokepoint

Every board mutation goes `recordSnapshot() → setState(optimistic) → persist(() => serverAction())`,
in that order — the snapshot must precede the state change or undo restores the post-change state,
which looks like undo doing nothing. `persist()` is one `useCallback` in `board.tsx`, called from
30 sites.

⚠️ **`opts.keys` and `opts.coalesceKey` are accepted and ignored.** They stay in the signature
because call sites pass them, and removing them would touch every one of those callers for nothing.
Do not "clean up" the signature.

⚠️ A write that throws is logged and the optimistic state is **not** rolled back. That is accepted:
a local SQLite write fails only on a real bug or a full disk, and a permanently green "saved"
indicator would be a lie by omission — which is why there is no write-status indicator anywhere.
