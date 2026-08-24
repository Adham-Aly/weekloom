---
name: recurring-series
description: Work on Weekloom's recurring tasks — how a finite series is materialised and extended, why origin_day_offset is the dedup key, and the invariants that make a weekday rotation and an arrow-shift behave differently. Use when touching recurrence, materializeSeries, applyItemMove, resizeItem, swapSteps, origin_day_offset, or debugging duplicated / missing / frozen occurrences.
---

# Recurring series

An item with a `recurrence` rule (`{ days, time, durationMin }`) has one step per occurrence. The
series is stored **finite**, and something has to extend it.

## Extension happens at launch and on wake. There is no scheduler.

`instrumentation.ts` runs `materializeAll()` once per server process — which for a desktop
application is exactly "the person launched Weekloom" — before the first request is served. It is
not a render and not a timer. `lib/calendar/materialize-trigger.ts` adds a `visibilitychange`
re-check behind a 6-hour predicate, closing the only remaining gap: a machine left open longer than
the 56-day window.

- ⚠️ **Do not add a cron, an interval or a background job.** The only reader of a board's steps is
  the board, so if the application is never opened there is nothing to extend. Opening it is the
  event.
- ⚠️ Materialisation is **idempotent** — it dedups on `origin_day_offset` — and its failure path is
  non-fatal and logged. So it also runs on every development-server restart, harmlessly. Do not add
  a guard against that.
- `MATERIALIZE_AHEAD_DAYS = 56` is a **row bound, not a limit on the person**: "materialise eight
  weeks at a time", so a series does not write ten years of rows into the file.

## ⚠️ 1. `origin_day_offset` is the series dedup key, never position

A recurring item's steps carry the offset the occurrence was _born_ at. If that is left NULL on a
sparse insert, the materialiser's watermark reads as `-1`, it proposes every offset, its
`WHERE NOT EXISTS` predicate is vacuously true, and the series gains **one duplicate stacked on
every occurrence, on every launch**, with nothing erroring.

`app/actions.ts` writes it only in sparse (recurring) mode; `materializeSeries` dedups on it;
`applyItemMove` rebases it **only where non-null**; `addStepAt` deliberately does not set it.
Pinned by `tests/origin-day-offset.test.ts`, which carries its own positive control.

## ⚠️ 2. `ruleDelta` is required exactly once, and must stay required

A weekday rotation and an arrow-shift reach `applyItemMove` in the _identical_ shape and need
**opposite** `origin_day_offset` behaviour. A `.default(0)` on the schema silently freezes origins
through a rotation and duplicates the series — reproduced at ~9 occurrences.

So `lib/actions/schemas.ts` keeps `z.number().int().min(-3650).max(3650)` with no `.optional()` and
no `.default()`, `ApplyItemMoveInput.ruleDelta` is a non-optional `number` so omitting it is a
compile error, and the port contains **no `?? 0`**. `lib/actions/schemas.test.ts` keeps a
`@ts-expect-error` case **whose unused-directive error is the alarm**.

## ⚠️ 3. No unique index on `(item_id, origin_day_offset)`, and negative origins are correct

Both absences are carried as explicit comments in the DDL, naming the bug each would reintroduce.

Detached and non-detached occurrences share the origin space, so a unique index makes a
scope-"all" weekday rotation collide with a frozen detached origin and the user's drag fails.

And a **negative** origin is correct: when an item's `start_date` slides later, a fixed
occurrence's offset from that start goes down and may pass zero — clamping at 0 collapses two
distinct occurrences onto one origin and the series duplicates.

## ⚠️ 4. `materializeSeries` only ever GROWS `duration_days`

Shrinking fights `resizeItem`, which owns that decision, and orphans steps past the new end.
`lib/db/rpc/materialize-series.test.ts` pins both directions.

## ⚠️ 5. `swapSteps` sets `detached` in the SAME statement as the swap

Omitting the flag made the materialisation planner silently skip five occurrences — the steps were
there, at the right offsets, and the series simply stopped growing past them.

## ⚠️ 6. `applyItemMove` distinguishes "a step vanished" from "nothing matched", and the step UPDATE runs BEFORE the item UPDATE

Collapsing the two outcomes into one made a lost drag retire as a success. The ordering is
load-bearing because the step rebase is computed against the item's _old_ `start_date`.

## Debugging guide

| symptom                                                     | look first at                                             |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| duplicates stacked on every occurrence, growing each launch | a NULL `origin_day_offset` on a sparse insert (1)         |
| a rotation freezes occurrences in place                     | a `.default(0)` or `?? 0` reintroduced on `ruleDelta` (2) |
| a drag fails outright on a rotated series                   | somebody added the unique index (3)                       |
| the series stops growing past a certain date                | `detached` not set in the swap statement (5)              |
| occurrences vanish after a resize                           | `materializeSeries` shrinking `duration_days` (4)         |

Because `components/**` has no unit coverage, reproduce a suspected series bug through
`npm run test:e2e` (`e2e/recurring.spec.ts`) or a `setUpTempDb()` case in `lib/`, not by reading
the board.
