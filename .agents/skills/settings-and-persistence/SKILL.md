---
name: settings-and-persistence
description: Change how Weekloom stores a preference or a piece of UI state — the one-row user_settings JSON document, why every caller must send a delta, the 400 ms debounced auto-save and its baseline ref, flushing on unmount, and the three localStorage keys that remain and why. Use when adding or removing a settings key, editing settings-form.tsx or updateSettings, touching localStorage, or debugging a preference that reverts, does not stick, or is lost on navigation.
---

# Settings and persisted UI state

One JSON document in `user_settings`, one row. `lib/types/settings.ts` owns the resolved shape, the
defaults and `settingsDelta`. `lib/db/settings.ts` owns the merge.

## ⚠️ 1. `updateSettings` MERGES its patch, so every caller must send a DELTA

The action does `{...existing, ...parsed}` inside one `tx`. A caller that posts its whole hydrated
state instead looks completely correct — until a second field, changed at some other moment, is
silently rewritten from a stale page-load snapshot. MEASURED with a form that sent all of its
fields at once: changing the theme reverted an unrelated setting to the value it had held when the
page loaded, which presents to the user as "a setting that doesn't do anything".

`components/settings-form.tsx` diffs through `settingsDelta` (tested in
`lib/types/settings.test.ts`) and sends only changed keys.

⚠️ **The merge is a shallow TypeScript spread and must not become `json_patch()`.** MEASURED:
`json_patch('{"a":1,"b":2}','{"b":null}')` returns `{"a":1}` — it **removes** a null-valued key
where a spread **sets** it to null. `activeBoardId` and `lastBlockId` are legitimately null, and
`lib/db/settings.test.ts` pins that a null sets rather than removes.

Adding a key means: the type, the default, the Zod allowlist at the action boundary, and a delta
test. ⚠️ The allowlist **strips server-set fields** — never widen one to admit an `id` or a
`created_at`.

## Three keys are board presentation state, and they live here on purpose

`chipModeByBlock` (per-lane chip mode, stamped by Shift+T / Shift+E), `collapsedItemIds` (which
items are collapsed) and `lastBlockId` (the lane the New-task modal pre-selects). They were moved
out of `localStorage` deliberately — see the last section. Three consequences:

- ⚠️ **They are written on every chevron click, so the board DEBOUNCES them** — one 400 ms timer in
  `board.tsx` carries all eight settings that component owns, in one delta. A synchronous
  `localStorage` write became a Server Action round trip when they moved, so collapsing ten lanes
  must cost one write and not ten. **Do not add a second, un-debounced write path.**
- ⚠️ **That effect's comparison baseline is what it LAST WROTE, held in a ref — never the
  `settings` prop.** The prop is a server-render snapshot and nothing refreshes it: Next's path- and
  tag-revalidation helpers are absent by design (`tests/no-cloud-imports.test.ts` forbids the path
  one by name) and the board never calls `router.refresh()`. Comparing against it asks "does this
  differ from disk AT PAGE LOAD", so a value changed and then changed BACK inside one page life
  reads as unchanged and its corrective write is skipped — leaving the row on the intermediate
  value. MEASURED: collapse a task's steps, expand them again, relaunch, and the task is collapsed
  again. `settings-form.tsx` holds the same kind of baseline for the same reason, and the two must
  agree. ⚠️ Keep the written keys in **one** `useMemo` feeding both the comparison and the payload,
  so a ninth key cannot be added to the write and forgotten in the guard.
- `lastBlockId` is dropped at READ time if the lane no longer exists, rather than cleared when a
  lane is deleted — which keeps a settings write off the delete path, where it would be one more
  thing for undo to reverse.

## ⚠️ 2. A debounced auto-save must be FLUSHED on the way out, not just cancelled

Two surfaces auto-save on that 400 ms timer: the board's eight-key patch and the Settings form's
delta. A teardown that only calls `clearTimeout` throws the pending write away — and "Settings" is
one click from the board, "Back" one click from every control on Settings, so leaving inside the
window issued **no write at all**. MEASURED: widen the sidebar, click Settings immediately,
relaunch — the old width is back, with nothing in the interface saying so.

`lib/hooks/use-flush-on-unload.ts` fires the pending patch on unmount **and** on `pagehide`. Both
callers keep a "what the server is known to hold" baseline, so the flush is a no-op once the timer
already fired and one departure still costs one write.

⚠️ **Unmount is the guaranteed leg; `pagehide` is best effort, and it is measurably not perfect.**
A renderer being torn down may be gone before the socket flushes, and no Server Action can go
through `navigator.sendBeacon` — it cannot set the `Next-Action` header. MEASURED on the standalone
build: an in-window route change kept the value every time, a window CLOSE 10/10 and a board RELOAD
10/10 — but a reload of the Settings page kept it only **15/20**. This narrows the loss window; **it
does not close it, and it must not be written up as though it did.** `e2e/ui-state.spec.ts`'s last
two tests pin the unmount leg, which is the leg that is actually guaranteed.

## What is left in `localStorage`, and why

Exactly three keys. Everything durable was moved into `user_settings` precisely so that no plan
state depends on the renderer's origin — **`localStorage` is keyed by origin, and the origin
includes the port.** The port is remembered in `~/.weekloom/port` so it usually stays stable, but
treat that as a small comfort rather than an invariant: **do not build anything new on it, and do
not put durable state in `localStorage` to lean on it.**

- **`gantt:theme`** — a **cache, not state**. SQLite is authoritative. It exists only so the
  pre-hydration inline script in `app/layout.tsx` can set `data-theme` before React loads, and that
  script cannot read SQLite. Moving it would defeat its only purpose. Worst case on a cold cache:
  one theme flash.
  ⚠️ **An empty browser context is not an empty cache.** A spec that visits `/settings` before
  `/app` WARMS this key; `e2e/ui-picker.spec.ts` deletes it explicitly before asserting, and
  MEASURED, without that line the test passed against a seed that was actually broken. Any
  assertion of the form "this came out of SQLite" must clear the cache first.
- **`gantt:notifs:fired`** — a per-day ledger of which notifications already fired. Worst case: one
  notification repeats after a relaunch.
- **`gantt:debug:notifs`** — a developer flag.

## ⚠️ Known, app-wide, and NOT fixed: a BACK navigation restores a stale theme and accent

Next reuses a dynamic page's payload on back/forward and nothing here invalidates it — no route
calls `router.refresh()`, and `revalidatePath` is forbidden by name in
`tests/no-cloud-imports.test.ts`. MEASURED identically on **both** surfaces that seed a theme from
the server: with `theme:"light"` and a custom accent on disk, `/app → /settings → change both →
Back` renders the old values and rewrites the `gantt:theme` cache to match. It self-heals on any
forward navigation or reload. The fix is client-cache invalidation on a settings write, applied to
every surface at once — a partial one would make two surfaces disagree about the same gesture.
