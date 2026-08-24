"use client";

import { createContext, useContext } from "react";

/**
 * Cross-cutting edit state for the Gantt grid, provided once around the board
 * body and consumed deep in the tree without threading through the
 * already-huge prop bags.
 *
 *  - `moveDeadline`: drag-move an item's deadline by a day delta.
 *
 * The only consumer today is the deadline marker inside
 * `components/gantt/board.tsx`. It stays a context rather than a prop because
 * the consumer sits several layers below the provider, and the alternative is
 * threading one callback through every intervening prop bag.
 */
export type BoardEditCtx = {
  /** Drag-move an item's deadline by a day delta (reuses the arrow-key shift). */
  moveDeadline: (itemId: string, deltaDays: number) => void;
};

const NOOP = () => {};

export const BoardEditContext = createContext<BoardEditCtx>({
  moveDeadline: NOOP,
});

export function useBoardEdit(): BoardEditCtx {
  return useContext(BoardEditContext);
}
