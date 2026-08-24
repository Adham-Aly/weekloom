/**
 * Undo/redo via state snapshots + per-table diff.
 *
 * Why snapshots and not an action log: every mutation site in board.tsx
 * just calls `recordSnapshot()` once before touching state. We don't have
 * to write a custom inverse for each callback (15+ of them) — the diff
 * layer figures out what changed and how to reverse it.
 */
import type { Block, Deadline, Item, Step } from "@/lib/types/database";

export type Snapshot = {
  blocks: Block[];
  items: Item[];
  steps: Step[];
  deadlines: Deadline[];
  pinnedItemIds: string[];
};

export type EntityDiff<T> = {
  /** Rows present in `target` but missing in `current` — must be (re)created. */
  created: T[];
  /** Row ids present in `current` but missing in `target` — must be deleted. */
  deleted: string[];
  /** Rows present in both with at least one differing field — full target row to UPDATE with. */
  updated: T[];
};

export type SnapshotDiff = {
  blocks: EntityDiff<Block>;
  items: EntityDiff<Item>;
  steps: EntityDiff<Step>;
  deadlines: EntityDiff<Deadline>;
  /** True iff pinnedItemIds changed (set semantics). */
  pinnedChanged: boolean;
};

/**
 * Shallow per-row clone is enough — Block/Item/Step/Deadline are flat
 * objects with primitive fields. Don't use `structuredClone` here; it's
 * 2-5× slower and unnecessary for these shapes.
 */
export function takeSnapshot(s: Snapshot): Snapshot {
  return {
    blocks: s.blocks.map((b) => ({ ...b })),
    items: s.items.map((i) => ({ ...i })),
    steps: s.steps.map((st) => ({ ...st })),
    deadlines: s.deadlines.map((d) => ({ ...d })),
    pinnedItemIds: [...s.pinnedItemIds],
  };
}

function diffTable<T extends { id: string }>(
  current: T[],
  target: T[],
): EntityDiff<T> {
  const curById = new Map(current.map((r) => [r.id, r]));
  const tgtById = new Map(target.map((r) => [r.id, r]));
  const created: T[] = [];
  const deleted: string[] = [];
  const updated: T[] = [];
  for (const [id, tgt] of tgtById) {
    const cur = curById.get(id);
    if (!cur) {
      created.push(tgt);
    } else if (!shallowEqual(cur, tgt)) {
      updated.push(tgt);
    }
  }
  for (const id of curById.keys()) {
    if (!tgtById.has(id)) deleted.push(id);
  }
  return { created, deleted, updated };
}

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

export function diffSnapshots(
  current: Snapshot,
  target: Snapshot,
): SnapshotDiff {
  const pinnedChanged =
    current.pinnedItemIds.length !== target.pinnedItemIds.length ||
    current.pinnedItemIds.some((id, i) => id !== target.pinnedItemIds[i]);
  return {
    blocks: diffTable(current.blocks, target.blocks),
    items: diffTable(current.items, target.items),
    steps: diffTable(current.steps, target.steps),
    deadlines: diffTable(current.deadlines, target.deadlines),
    pinnedChanged,
  };
}

/** Total number of server ops the diff implies — used for guardrail logging. */
export function diffOpCount(d: SnapshotDiff): number {
  const tableOps = (e: EntityDiff<unknown>) =>
    e.created.length + e.deleted.length + e.updated.length;
  return (
    tableOps(d.blocks) +
    tableOps(d.items) +
    tableOps(d.steps) +
    tableOps(d.deadlines) +
    (d.pinnedChanged ? 1 : 0)
  );
}
