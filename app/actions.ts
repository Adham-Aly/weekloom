"use server";

import { z } from "zod";
import type { Json } from "@/lib/types/database";
import {
  type ApplyItemMoveInput,
  blockCreateSchema,
  blockUpdateSchema,
  boardCreateSchema,
  boardUpdateSchema,
  deadlineCreateSchema,
  itemCreateSchema,
  settingsPatchSchema,
  uuidSchema,
} from "@/lib/actions/schemas";
import {
  ActionError,
  requireRow,
  sanitizeAction as sanitize,
} from "@/lib/domain/errors";
/**
 * Re-exported as Server Actions over the single implementation in
 * `lib/domain`. Explicit wrappers rather than `export { x } from "..."`: a
 * `"use server"` module may only export async functions, and a bare re-export
 * is not obviously registered as an action reference by the compiler — a
 * failure that would be silent.
 */
import { updateStep as domainUpdateStep } from "@/lib/domain/steps";
import {
  applyItemMove as domainApplyItemMove,
  updateItem as domainUpdateItem,
} from "@/lib/domain/items";
import { toISODate } from "@/lib/utils";
import { tx } from "@/lib/db/tx";
import {
  deleteBoardRow,
  getBoard,
  insertBoard,
  listBoards,
  updateBoardRow,
} from "@/lib/db/boards";
import {
  blockBoardId,
  deleteBlockRow,
  deleteItemsByBlock,
  getBlock,
  listBlocksAll,
  updateBlockRow,
  upsertBlock,
} from "@/lib/db/blocks";
import {
  deleteItemRow,
  itemBoardId,
  listItemsAll,
  updateItemRow,
  upsertItem,
} from "@/lib/db/items";
import {
  deleteStepRow,
  deleteStepsByIds,
  insertSteps,
  listDoneStepsSince,
  listStepsByItem,
  upsertStep,
  upsertSteps,
} from "@/lib/db/steps";
import { deleteDeadlineRow, upsertDeadline } from "@/lib/db/deadlines";
import { mergeSettingsPatch, readSettings } from "@/lib/db/settings";
import { swapSteps as dbSwapSteps } from "@/lib/db/rpc/swap-steps";
import { seedLocalData } from "@/lib/db/rpc/seed";
import { materializeAll } from "@/lib/db/materialize";

/**
 * The whole mutation surface of the application, and the only thing the
 * renderer may call.
 *
 * Two rules hold across every export below, and they are what make the file
 * readable as one thing:
 *
 *  1. **The house shape.** `try { parse → derive scope → write → return }
 *     catch (e) { sanitize(e, "Could not …") }`. Every user-facing failure
 *     message starts with `"Could not "`, and `sanitize` is what stops a raw
 *     SQLite constraint name reaching the UI.
 *  2. **Zod at every input boundary.** The renderer is a separate process
 *     running a DOM; `lib/actions/schemas.ts` is the allowlist that decides
 *     which fields it may set, and a `board_id` a parent row can derive is
 *     never taken from the caller.
 *
 * Nothing here asks Next to re-render a route, deliberately. Both data pages
 * are `force-dynamic`, so there is no cached payload to invalidate — every
 * navigation re-reads SQLite — and asking for one would put a full re-render
 * of the board page into the response of every keystroke.
 */
const SETTINGS_MAX_BYTES = 64 * 1024;

// ─── Boards ─────────────────────────────────────────────────────────────
export async function createBoard(input: unknown) {
  try {
    const fields = boardCreateSchema.parse(input);
    // One transaction: a board that exists without its Completed lane would
    // render a board whose finished tasks have nowhere to go.
    return tx(() => {
      const board = insertBoard(fields);
      // Each board gets its own Completed system block (items auto-move here
      // when all steps are done). Created up-front so it always exists.
      upsertBlock({
        board_id: board.id,
        name: "Completed",
        color: "#10b981",
        sort_order: 9999,
        is_system: true,
      });
      return board;
    });
  } catch (e) {
    sanitize(e, "Could not create board");
  }
}

export async function updateBoard(id: string, patch: unknown) {
  try {
    const boardId = uuidSchema.parse(id);
    const fields = boardUpdateSchema.parse(patch);
    if (Object.keys(fields).length === 0) return;
    const board = updateBoardRow(boardId, fields);
    if (!board) throw new ActionError("Board not found");
    return board;
  } catch (e) {
    sanitize(e, "Could not update board");
  }
}

export async function deleteBoard(id: string) {
  try {
    const boardId = uuidSchema.parse(id);
    if (!getBoard(boardId)) throw new ActionError("Board not found");
    // The FK cascade removes the board's blocks, items, steps and deadlines.
    // ⚠️ That cascade is only armed because `lib/db/connection.ts` sets
    // `PRAGMA foreign_keys = ON` — it is per-connection and OFF by default in
    // SQLite, which is why nothing else in the app may open a handle.
    deleteBoardRow(boardId);
  } catch (e) {
    sanitize(e, "Could not delete board");
  }
}

/**
 * Persist the active board into `user_settings.activeBoardId`. Merges into the
 * existing settings document like {@link updateSettings} does, so other keys
 * are preserved; bare `/app` reads this on load.
 */
export async function setActiveBoard(boardId: string) {
  try {
    const id = uuidSchema.parse(boardId);
    if (!getBoard(id)) throw new ActionError("Board not found");
    mergeSettingsPatch({ activeBoardId: id });
  } catch (e) {
    sanitize(e, "Could not set active board");
  }
}

// ─── Home stats ─────────────────────────────────────────────────────────
/** Per-board metadata for the home screen list (task count, last touched). */
export type BoardMeta = {
  taskCount: number;
  /** ISO timestamp the board was last updated. */
  updatedAt: string;
  /** Steps completed on this board in the last 30 days (drives the influence
   *  donut — "which board you're most locked in on"). */
  completed30: number;
};

export type HomeStats = {
  /** Things checked off in the trailing 7 days (steps marked done). */
  doneThisWeek: number;
  /** Minutes of effort completed this week (sum of done steps' duration_min). */
  minutesThisWeek: number;
  /** Distinct days with a completion in the last 30 — a consistency signal. */
  activeDays30: number;
  /** One entry per day for the last 30 days (oldest→newest): completions/day.
   *  Powers the home-screen dot-density chart. */
  daily: { date: string; count: number }[];
  /** One entry per day for the last ~18 weeks (oldest→newest): completions/day.
   *  Powers the GitHub-style contribution grid. */
  contributions: { date: string; count: number }[];
  /** boardId → { taskCount, updatedAt } for every board. */
  boardMeta: Record<string, BoardMeta>;
  /** Per-block completed work (30d) across all boards — "which block you're
   *  most locked in on". Powers the focus radar. Sorted desc by completed. */
  blockFocus: { name: string; color: string; completed: number }[];
};

/**
 * Read-only "your week" summary for the home screen, derived from steps (not
 * an event log) so the numbers map to things people recognise: what they
 * checked off, how much focused time that represents, and how many days they
 * showed up. Best-effort — returns zeros on any error, since it is a
 * non-critical surface and a broken chart must not block the board list.
 */
export async function getHomeStats(): Promise<HomeStats> {
  const empty: HomeStats = {
    doneThisWeek: 0,
    minutesThisWeek: 0,
    activeDays30: 0,
    daily: [],
    contributions: [],
    boardMeta: {},
    blockFocus: [],
  };
  try {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    // ~53 weeks back (a full year, like GitHub) for the contribution grid —
    // enough columns to fill a wide panel; the client renders only as many as
    // fit and keeps the most recent.
    const GRID_DAYS = 53 * 7;
    const gridStart = new Date(
      Date.now() - GRID_DAYS * 86_400_000,
    ).toISOString();

    // Done steps over the grid window (covers the 7/30-day metrics too) +
    // per-board task counts + board timestamps. Four synchronous reads.
    const doneSteps = listDoneStepsSince(gridStart);
    const boards = listBoards();
    const items = listItemsAll();
    const blocks = listBlocksAll();

    // item_id → block_id (for mapping completed steps to their block).
    const itemBlock = new Map<string, string>();
    for (const it of items) {
      if (it.block_id) itemBlock.set(it.id, it.block_id);
    }

    let doneThisWeek = 0;
    let minutesThisWeek = 0;
    const activeDays = new Set<string>(); // 30d only
    const perDay = new Map<string, number>(); // YYYY-MM-DD → completions (all window)
    const perBoardDone = new Map<string, number>(); // board_id → completions (30d)
    const perBlockDone = new Map<string, number>(); // block_id → completions (30d)
    for (const s of doneSteps) {
      if (!s.completed_at) continue;
      const day = s.completed_at.slice(0, 10); // YYYY-MM-DD
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      // The board/block focus + active-days metrics are explicitly "last 30d",
      // so gate them even though the query pulls a wider window for the grid.
      const within30 = s.completed_at >= monthAgo;
      if (within30) {
        activeDays.add(day);
        if (s.board_id) {
          perBoardDone.set(s.board_id, (perBoardDone.get(s.board_id) ?? 0) + 1);
        }
        const blockId = itemBlock.get(s.item_id);
        if (blockId) {
          perBlockDone.set(blockId, (perBlockDone.get(blockId) ?? 0) + 1);
        }
      }
      if (s.completed_at >= weekAgo) {
        doneThisWeek += 1;
        minutesThisWeek += s.duration_min ?? 0;
      }
    }

    // Helper: dense zero-filled day series ending today (oldest→newest).
    const today = new Date();
    const series = (numDays: number) => {
      const out: { date: string; count: number }[] = [];
      for (let i = numDays - 1; i >= 0; i--) {
        const key = new Date(today.getTime() - i * 86_400_000)
          .toISOString()
          .slice(0, 10);
        out.push({ date: key, count: perDay.get(key) ?? 0 });
      }
      return out;
    };
    const daily = series(30); // dot chart
    const contributions = series(53 * 7); // GitHub-style grid (~1 year)

    // Per-board task counts.
    const counts = new Map<string, number>();
    for (const it of items) {
      if (!it.board_id) continue;
      counts.set(it.board_id, (counts.get(it.board_id) ?? 0) + 1);
    }
    const boardMeta: Record<string, BoardMeta> = {};
    for (const b of boards) {
      boardMeta[b.id] = {
        taskCount: counts.get(b.id) ?? 0,
        updatedAt: b.updated_at,
        completed30: perBoardDone.get(b.id) ?? 0,
      };
    }

    // Per-block focus (exclude the system "Completed" block), sorted desc.
    const blockFocus = blocks
      .filter((b) => !b.is_system)
      .map((b) => ({
        name: b.name,
        color: b.color ?? "#3b82f6",
        completed: perBlockDone.get(b.id) ?? 0,
      }))
      .sort((a, b) => b.completed - a.completed);

    return {
      doneThisWeek,
      minutesThisWeek,
      activeDays30: activeDays.size,
      daily,
      contributions,
      boardMeta,
      blockFocus,
    };
  } catch {
    return empty;
  }
}

// ─── Blocks ─────────────────────────────────────────────────────────────
export async function createBlock(input: unknown) {
  try {
    const fields = blockCreateSchema.parse(input);
    // Upsert on a caller-provided id so a repeated create (undo-of-delete,
    // a double submit) is idempotent rather than a duplicate lane.
    return upsertBlock(fields);
  } catch (e) {
    sanitize(e, "Could not create block");
  }
}

export async function updateBlock(id: string, patch: unknown) {
  try {
    const blockId = uuidSchema.parse(id);
    const fields = blockUpdateSchema.parse(patch);
    if (Object.keys(fields).length === 0) return;
    updateBlockRow(blockId, fields);
  } catch (e) {
    sanitize(e, "Could not update block");
  }
}

export async function deleteBlock(id: string) {
  try {
    const blockId = uuidSchema.parse(id);
    const block = getBlock(blockId);
    if (block?.is_system) {
      throw new ActionError(`Cannot delete system block "${block.name}"`);
    }
    // Deleting a block hard-deletes everything inside it — the client's confirm
    // dialog promises "All items and steps inside this block will be deleted".
    //
    // ⚠️ `items.block_id` IS `ON DELETE CASCADE` (verified against the schema in
    // `lib/db/schema.ts`), so the explicit item delete is belt-and-braces, not
    // the load-bearing thing an older comment here claimed. It is kept because
    // FK enforcement in SQLite is a PER-CONNECTION pragma: if a future handle
    // is ever opened without it, this line is the difference between a clean
    // delete and items orphaned into a lane that no longer exists.
    tx(() => {
      deleteItemsByBlock(blockId);
      deleteBlockRow(blockId);
    });
  } catch (e) {
    sanitize(e, "Could not delete block");
  }
}

// ─── Items + Steps ──────────────────────────────────────────────────────
/**
 * Optionally accept caller-provided UUIDs for the item + each step. When the
 * client generates these up-front, the optimistic UI uses the same React keys
 * as the persisted rows — no remount/animation replay when the write lands.
 */
export async function createItemWithSteps(input: unknown) {
  try {
    const parsed = itemCreateSchema.parse(input);
    // Board scope: a normal item derives it authoritatively from its parent
    // block (so it can't be stamped into a different board). A blockless
    // (calendar-only) item has no block, so the caller's board_id is used —
    // checked here rather than left to the FK, which would surface as a
    // generic failure.
    let boardId: string;
    if (parsed.block_id) {
      const blockId = parsed.block_id;
      boardId = requireRow(() => blockBoardId(blockId), "Block not found");
    } else {
      if (!getBoard(parsed.board_id)) throw new ActionError("Board not found");
      boardId = parsed.board_id;
    }
    const {
      id: providedItemId,
      stepIds: providedStepIds,
      stepTime,
      stepDurationMin,
      stepLabel,
      stepOffsets,
      ...itemFields
    } = parsed;
    // Sparse mode (recurring series): duration covers the last occurrence.
    const duration =
      parsed.duration_days ??
      (stepOffsets?.length ? Math.max(...stepOffsets) + 1 : 1);

    const itemRow = {
      ...itemFields,
      ...(providedItemId ? { id: providedItemId } : {}),
      // Stamped AFTER ...itemFields so the block-derived board scope wins
      // over any board_id the client sent (items can't cross boards).
      board_id: boardId,
      duration_days: duration,
      // Deadline starts one column past the last planned day. Never auto-syncs after.
      deadline_offset: itemFields.deadline_offset ?? duration,
    };

    // One transaction: an item without its steps is a bar with nothing under
    // it, and these used to be two round trips that could half-apply.
    return tx(() => {
      // With a caller-provided id, upsert on conflict so a repeated create is
      // idempotent (no duplicate row, and no primary-key conflict).
      const item = upsertItem(itemRow);

      // Contiguous mode: one step per day of the duration, with the optional
      // label/time/duration on the FIRST step (calendar quick-create).
      // Sparse mode (stepOffsets, recurring series): one step per listed
      // offset, EVERY one carrying the time/duration — each is a full
      // occurrence. Labels stay empty so the series has one rename surface
      // (the item title).
      const offsets = stepOffsets?.length
        ? stepOffsets
        : Array.from({ length: duration }, (_, i) => i);
      const sparse = !!stepOffsets?.length;
      const rows = offsets.map((day_offset, i) => ({
        ...(providedStepIds?.[i] ? { id: providedStepIds[i] } : {}),
        item_id: item.id,
        board_id: boardId,
        day_offset,
        label: !sparse && i === 0 && stepLabel ? stepLabel : "",
        // A founding occurrence of a recurring series MUST record which
        // occurrence it is, or the materializer cannot tell it apart from a
        // manually-added step.
        //
        // `planMaterialization` computes the watermark as
        // `max(steps.origin_day_offset)`. With every founding row NULL that set is
        // empty, the watermark is -1, and it proposes EVERY offset from 0 —
        // while `materializeSeries` inserts only `where not exists (item_id = ...
        // and origin_day_offset = o)`, which is vacuously true for all of them.
        // The result is one duplicate occurrence stacked on top of every step
        // this create just made.
        //
        // It stayed invisible because the optimistic client row already sets this
        // correctly (`board.tsx`), so the browser that created the series
        // renders the right value while the database holds NULL — until a reload
        // or the next wake's `materializeBoardSeries`.
        //
        // Sparse-only, matching the client exactly: a contiguous item is not a
        // series, and `lib/calendar/materialize.ts` requires manual `addStepAt` /
        // resize-grow rows to STAY null ("a step with a null origin_day_offset
        // contributes nothing — it is not an occurrence").
        ...(sparse ? { origin_day_offset: day_offset } : {}),
        ...((sparse || i === 0) && stepTime ? { time_of_day: stepTime } : {}),
        ...((sparse || i === 0) && stepDurationMin != null
          ? { duration_min: stepDurationMin }
          : {}),
      }));
      // Same idempotency: when the client supplied step ids, upsert so a
      // repeat doesn't insert duplicates or fail on the primary key.
      const stepsHaveIds = rows.every((r) => "id" in r);
      const steps = stepsHaveIds ? upsertSteps(rows) : insertSteps(rows);
      return { item, steps };
    });
  } catch (e) {
    sanitize(e, "Could not create item");
  }
}

/** Server Action wrapper. Implementation and rationale: `lib/domain/items.ts`. */
export async function updateItem(id: string, patch: unknown) {
  return domainUpdateItem(id, patch);
}

export async function resizeItem(itemId: string, newDuration: number) {
  try {
    const id = uuidSchema.parse(itemId);
    const duration = z.number().int().min(1).max(730).parse(newDuration);
    // Any steps grown here inherit the parent item's board scope.
    const boardId = requireRow(() => itemBoardId(id), "Item not found");

    return tx(() => {
      const current = listStepsByItem(id);
      // duration_days is anchored on max(day_offset)+1, NOT on count —
      // items with gaps (from earlier deletes) make count and max+1
      // diverge. Using count as the comparison/insertion baseline made
      // grows insert (duration - count) rows starting at max+1, which
      // over-counted on any gappy item ("extend by 1 added 2-3 days").
      const maxOffset = current.length
        ? Math.max(...current.map((s) => s.day_offset))
        : -1;
      const currentSlots = maxOffset + 1;

      if (duration < currentSlots) {
        const idsToDrop = current
          .filter((s) => s.day_offset >= duration)
          .map((s) => s.id);
        if (idsToDrop.length) deleteStepsByIds(idsToDrop);
      } else if (duration > currentSlots) {
        // Add exactly `duration - currentSlots` rows, starting at
        // currentSlots (= maxOffset + 1). Each new row gets a unique
        // offset that doesn't collide with existing ones.
        const addCount = duration - currentSlots;
        insertSteps(
          Array.from({ length: addCount }, (_, i) => ({
            item_id: id,
            board_id: boardId,
            day_offset: currentSlots + i,
            label: "",
          })),
        );
      }

      updateItemRow(id, { duration_days: duration });
      return listStepsByItem(id);
    });
  } catch (e) {
    sanitize(e, "Could not resize item");
  }
}

export async function deleteItem(id: string) {
  try {
    const itemId = uuidSchema.parse(id);
    // The FK cascade takes the item's steps with it.
    deleteItemRow(itemId);
  } catch (e) {
    sanitize(e, "Could not delete item");
  }
}

// ─── Steps ──────────────────────────────────────────────────────────────
/** Server Action wrapper. Implementation and rationale: `lib/domain/steps.ts`. */
export async function updateStep(id: string, patch: unknown) {
  return domainUpdateStep(id, patch);
}

export async function deleteStep(id: string) {
  try {
    const stepId = uuidSchema.parse(id);
    deleteStepRow(stepId);
  } catch (e) {
    sanitize(e, "Could not delete step");
  }
}

export async function addStepAt(
  itemId: string,
  dayOffset: number,
  stepId?: string,
) {
  try {
    const id = uuidSchema.parse(itemId);
    const offset = z.number().int().min(0).max(3650).parse(dayOffset);
    const parsedStepId = stepId ? uuidSchema.parse(stepId) : undefined;
    // Step inherits its board scope from the parent item.
    const boardId = requireRow(() => itemBoardId(id), "Item not found");
    // ⚠️ No `origin_day_offset`. A hand-added step is not a rule occurrence,
    // and giving it an origin makes the materializer treat it as one — which
    // poisons the watermark and silently stops the series extending.
    return upsertStep({
      ...(parsedStepId ? { id: parsedStepId } : {}),
      item_id: id,
      board_id: boardId,
      day_offset: offset,
      label: "",
    });
  } catch (e) {
    sanitize(e, "Could not add step");
  }
}

/**
 * Apply a step-by-step day_offset update map plus optional item start_date /
 * duration_days adjustments in one call. Used by Gantt selection shifts to
 * support auto-grow + auto-shift-start behaviour atomically.
 */
export async function applyItemMove(input: ApplyItemMoveInput) {
  return domainApplyItemMove(input);
}

export async function swapSteps(aId: string, bId: string) {
  try {
    const a = uuidSchema.parse(aId);
    const b = uuidSchema.parse(bId);
    dbSwapSteps(a, b);
  } catch (e) {
    sanitize(e, "Could not swap steps");
  }
}

// ─── Deadlines ──────────────────────────────────────────────────────────
export async function createDeadline(input: unknown) {
  try {
    // board_id is required by deadlineCreateSchema (deadlines are standalone,
    // so they carry their own board scope from the active board) and rides
    // onto the insert via the `...fields` spread below.
    const fields = deadlineCreateSchema.parse(input);
    // Upsert on a caller-provided id so undo-of-delete is idempotent.
    return upsertDeadline(fields);
  } catch (e) {
    sanitize(e, "Could not create deadline");
  }
}

export async function deleteDeadline(id: string) {
  try {
    const deadlineId = uuidSchema.parse(id);
    deleteDeadlineRow(deadlineId);
  } catch (e) {
    sanitize(e, "Could not delete deadline");
  }
}

// ─── Settings ───────────────────────────────────────────────────────────
export async function getSettings(): Promise<Record<string, Json>> {
  try {
    return readSettings();
  } catch (e) {
    sanitize(e, "Could not load settings");
  }
}

/**
 * ⚠️ **This MERGES its patch, so every caller must send a DELTA — never the
 * whole settings object.**
 *
 * `user_settings.settings` is one JSON document and this action shallow-merges
 * into it. A caller that sends its entire hydrated state turns a one-key edit
 * into a full-document overwrite from whatever snapshot it happened to load,
 * silently reverting anything set elsewhere since. `settingsDelta`
 * (`lib/types/settings.ts`) exists so the settings form cannot make that
 * mistake; every other caller already sends a minimal patch.
 */
export async function updateSettings(patch: unknown) {
  try {
    const parsed = settingsPatchSchema.parse(patch) as Record<string, Json>;
    // Size is checked against the MERGED document, because that is what gets
    // stored. Both calls are synchronous with no await between them, so
    // nothing can land in the gap between the check and the write.
    const merged = { ...readSettings(), ...parsed };
    if (JSON.stringify(merged).length > SETTINGS_MAX_BYTES) {
      throw new ActionError("Settings payload too large");
    }
    // The DELTA goes to the data layer, never `merged` — see the note above.
    mergeSettingsPatch(parsed);
  } catch (e) {
    sanitize(e, "Could not save settings");
  }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────
/**
 * First-run bootstrap: a board, its Completed lane, and one General lane to
 * put the first task in. Idempotent — every guard is a `WHERE NOT EXISTS`
 * predicate, so someone who deliberately deleted the General lane does not get
 * it back on the next launch.
 */
export async function seedIfEmpty() {
  seedLocalData();
}

/**
 * Extend every recurring series on one board out to the rolling horizon.
 *
 * The launch pass in `instrumentation.ts` is what normally does this; the
 * board calls here only on tab wake, for the one case a launch pass cannot
 * cover — a machine left open longer than the window.
 */
export async function materializeBoardSeries(boardId: string) {
  try {
    const id = uuidSchema.parse(boardId);
    return materializeAll(toISODate(new Date()), id);
  } catch (e) {
    sanitize(e, "Could not extend recurring tasks");
  }
}
