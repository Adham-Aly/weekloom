import {
  planMaterialization,
  type MaterializableStep,
} from "@/lib/calendar/materialize";
import { MATERIALIZE_AHEAD_DAYS } from "@/lib/calendar/recurrence";
import { listRecurringItems } from "@/lib/db/items";
import { materializeSeries } from "@/lib/db/rpc/materialize-series";
import { listStepsByItemIds } from "@/lib/db/steps";

export type MaterializeResult = { created: number; series: number };

/**
 * Extend every recurring series to the rolling horizon, and report what that
 * took.
 *
 * Called once per server process from `instrumentation.ts` — which for a desktop
 * app is exactly "the user launched the app" — and again from the board when a
 * window has been left open long enough to outrun the horizon. It is deliberately
 * **not** a timer and **not** a write performed by a render.
 *
 * ⚠️ **One wedged series must not freeze every series after it.** The per-series
 * `try`/`catch` is why this is a loop with a catch inside it rather than one
 * transaction: the alternative is a single bad row stopping every other series
 * from extending, permanently and silently. This function is therefore
 * deliberately not itself a `tx` — each `materializeSeries` call is its own
 * outermost transaction, so a failure rolls back that series and nothing else.
 */
export function materializeAll(
  todayISO: string,
  boardId?: string,
): MaterializeResult {
  const items = listRecurringItems(boardId);
  if (items.length === 0) return { created: 0, series: 0 };

  const steps = listStepsByItemIds(items.map((i) => i.id));
  const byItem = new Map<string, MaterializableStep[]>();
  for (const s of steps) {
    const list = byItem.get(s.item_id) ?? [];
    list.push(s);
    byItem.set(s.item_id, list);
  }

  let created = 0;
  let series = 0;
  for (const item of items) {
    const rule = item.recurrence;
    // `listRecurringItems` filters on the column, but a row whose JSON failed to
    // parse comes back as null — and a series with no rule has no occurrences.
    if (!rule) continue;
    const plan = planMaterialization(
      item,
      byItem.get(item.id) ?? [],
      todayISO,
      MATERIALIZE_AHEAD_DAYS,
    );
    if (plan.offsets.length === 0) continue;

    try {
      created += materializeSeries({
        itemId: item.id,
        offsets: plan.offsets,
        time: rule.time,
        durationMin: rule.durationMin,
        newDuration: plan.newDuration,
      });
      series += 1;
    } catch (e) {
      console.error("[db/materialize] series failed", {
        itemId: item.id,
        reason: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
  }
  return { created, series };
}
