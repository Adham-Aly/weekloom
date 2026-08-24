"use client";

import { useCallback, useRef } from "react";
import {
  diffOpCount,
  diffSnapshots,
  takeSnapshot,
  type Snapshot,
} from "./snapshot";
import { applyDiff } from "./sync";

/**
 * How many whole-board snapshots the undo and redo stacks each hold.
 *
 * ⚠️ **This is a memory bound, not a feature level, and it must never be
 * `Infinity`.** Each entry is a deep-copied snapshot of every block, item,
 * step and deadline on the board (`snapshot.ts`), and the stacks are trimmed
 * below by `shift()`ing only when `length > MAX_STACK` — so an infinite bound
 * never shifts and the stacks grow until the tab runs out of memory.
 *
 * There is deliberately no way for a caller to change it. An optional
 * argument would invite a caller-supplied depth, and the bound belongs to the
 * memory this process has rather than to anything a caller knows; a constant
 * is what keeps that true.
 */
const MAX_STACK = 50;
const PERF_WARN_OPS = 50;
const PERF_WARN_SNAPSHOT_MS = 10;

export type UndoApi = {
  /** Snapshot the current state before mutating. Clears the redo stack. */
  recordSnapshot: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
};

/**
 * Snapshot-based undo/redo bound to the board's data state. The caller supplies
 * a getter for current state and a setter for each table, so the hook stays
 * agnostic to where the state lives (in board.tsx it is split across several
 * useState calls).
 *
 * Stacks are in-memory refs — undo history is per-session and is not persisted.
 * Capped at {@link MAX_STACK} to bound memory; older snapshots fall off.
 */
export function useUndo(opts: {
  getState: () => Snapshot;
  applyState: (s: Snapshot) => void;
  onError?: (message: string) => void;
}): UndoApi {
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  // Re-entrancy guard so the undo/redo's own state writes don't trigger
  // recordSnapshot via some upstream effect.
  const inFlight = useRef(false);

  const recordSnapshot = useCallback(() => {
    if (inFlight.current) return;
    const t0 = performance.now();
    const snap = takeSnapshot(opts.getState());
    const elapsed = performance.now() - t0;
    if (elapsed > PERF_WARN_SNAPSHOT_MS) {
      console.warn(
        `[undo] snapshot took ${elapsed.toFixed(1)}ms — large board?`,
      );
    }
    undoStack.current.push(snap);
    if (undoStack.current.length > MAX_STACK) undoStack.current.shift();
    // Any new mutation invalidates the redo history.
    redoStack.current.length = 0;
  }, [opts]);

  const apply = useCallback(
    async (target: Snapshot, pushTo: Snapshot[]) => {
      const current = takeSnapshot(opts.getState());
      const diff = diffSnapshots(current, target);
      const ops = diffOpCount(diff);
      if (ops === 0) return;
      if (ops > PERF_WARN_OPS) {
        console.warn(
          `[undo] applying ${ops} server ops — heavy diff (deleted block?)`,
        );
      }
      pushTo.push(current);
      if (pushTo.length > MAX_STACK) pushTo.shift();

      inFlight.current = true;
      try {
        opts.applyState(target);
        // `applyDiff` swallows per-op failures itself and never throws, so a
        // single bad row cannot abort the rest of the restore; it reports the
        // count instead.
        const { errors } = await applyDiff(
          diff,
          target.steps,
          target.pinnedItemIds,
        );
        if (errors > 0) {
          opts.onError?.(
            `Undo synced with ${errors} error${errors === 1 ? "" : "s"} — reload to verify.`,
          );
        }
      } finally {
        inFlight.current = false;
      }
    },
    [opts],
  );

  const undo = useCallback(async () => {
    const target = undoStack.current.pop();
    if (!target) return;
    await apply(target, redoStack.current);
  }, [apply]);

  const redo = useCallback(async () => {
    const target = redoStack.current.pop();
    if (!target) return;
    await apply(target, undoStack.current);
  }, [apply]);

  return {
    recordSnapshot,
    undo,
    redo,
    canUndo: () => undoStack.current.length > 0,
    canRedo: () => redoStack.current.length > 0,
  };
}
