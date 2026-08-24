"use client";

import { useMemo, useRef } from "react";

type Axis = "x" | "y";

/**
 * Spreadsheet-style resize drag: while the user drags, we DON'T touch
 * React state at all. A fixed-positioned guideline DIV is appended to
 * the document body and updated via direct DOM mutation. On pointer-up
 * we commit the final value to React state once.
 *
 * This is much snappier than live-resize because no component re-renders
 * during the drag — the cost of repositioning a single 2px-wide line is
 * basically zero, even on a Gantt with hundreds of rows.
 */
export function useResizeDrag(opts: {
  axis: Axis;
  min: number;
  max: number;
  onCommit: (next: number) => void;
}) {
  // Keep the latest opts in a ref so the handler closures always read
  // fresh callbacks without re-creating the handlers.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Per-instance drag state.
  const stateRef = useRef({
    startCursor: 0,
    startValue: 0,
    pending: 0,
    guideline: null as HTMLDivElement | null,
  });

  return useMemo(() => {
    // Centralised cleanup: removes the guideline, restores the body cursor,
    // and commits the final value if it actually changed. Safe to call
    // multiple times (idempotent — short-circuits on null guideline).
    function cleanup() {
      const s = stateRef.current;
      if (!s.guideline) return;
      s.guideline.remove();
      s.guideline = null;
      // Intentional imperative DOM write: this hook drives the drag entirely
      // through direct DOM mutation (no React state) for performance, and
      // cleanup runs from pointer/window event handlers — never during render.
      // The compiler's render-purity rule doesn't apply here.
      // eslint-disable-next-line react-hooks/immutability
      document.body.style.cursor = "";
      window.removeEventListener("pointerup", windowEnd);
      window.removeEventListener("pointercancel", windowEnd);
      if (s.pending !== s.startValue) optsRef.current.onCommit(s.pending);
    }
    function windowEnd() {
      cleanup();
    }

    function start(e: React.PointerEvent, startValue: number) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const { axis } = optsRef.current;
      const cursor = axis === "x" ? e.clientX : e.clientY;
      stateRef.current.startCursor = cursor;
      stateRef.current.startValue = startValue;
      stateRef.current.pending = startValue;

      const line = document.createElement("div");
      line.style.cssText =
        axis === "x"
          ? "position:fixed;top:0;bottom:0;width:2px;background:var(--accent);z-index:9999;pointer-events:none;opacity:0.6"
          : "position:fixed;left:0;right:0;height:2px;background:var(--accent);z-index:9999;pointer-events:none;opacity:0.6";
      if (axis === "x") line.style.left = `${cursor}px`;
      else line.style.top = `${cursor}px`;
      document.body.appendChild(line);
      stateRef.current.guideline = line;
      document.body.style.cursor = axis === "x" ? "col-resize" : "ns-resize";

      // Safety net: a window-level pointerup listener that guarantees
      // cleanup even if the per-element pointerup is somehow swallowed
      // (e.g., a parent overflow:hidden routes pointer events oddly, or
      // the user lifts pointer outside the document).
      window.addEventListener("pointerup", windowEnd);
      window.addEventListener("pointercancel", windowEnd);
    }

    function move(e: React.PointerEvent) {
      const s = stateRef.current;
      if (!s.guideline) return;
      const { axis, min, max } = optsRef.current;
      const cursor = axis === "x" ? e.clientX : e.clientY;
      const delta = cursor - s.startCursor;
      const clamped = Math.max(min, Math.min(max, s.startValue + delta));
      s.pending = clamped;
      // Position the guideline at the *clamped* offset, so it visibly
      // sticks when you drag past min/max instead of running off-screen.
      const visualCursor = s.startCursor + (clamped - s.startValue);
      if (axis === "x") s.guideline.style.left = `${visualCursor}px`;
      else s.guideline.style.top = `${visualCursor}px`;
    }

    function end(e: React.PointerEvent) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Pointer was already released (rare); ignore.
      }
      cleanup();
    }

    return { start, move, end };
  }, []);
}
