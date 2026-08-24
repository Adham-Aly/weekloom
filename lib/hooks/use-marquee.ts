"use client";

import { useEffect, useRef, useState } from "react";

export type MarqueeRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/**
 * Spreadsheet-style click-and-drag marquee selection. Both the Gantt and the
 * Calendar use the same shape, so the hook owns the lasso state, the global
 * pointermove/pointerup tracking, and intersection-testing against the
 * caller-supplied target selector.
 *
 * The caller provides:
 *   - `targetSelector`: CSS selector for selectable elements
 *   - `onIntersect`: invoked on every pointermove with the matched elements
 *     and the current marquee rect — return value drives whatever selection
 *     model the caller uses (flat set, scoped set, etc.)
 *
 * The hook returns:
 *   - `onPointerDown`: bind to the surface you want to lasso-from
 *   - `lasso`: the current rect (for rendering an overlay), or null
 *
 * The pointer-down handler ignores presses on buttons, inputs, and any
 * element matching `[data-no-lasso]`, so child controls keep working.
 */
export function useMarquee(opts: {
  targetSelector: string;
  onIntersect: (matched: HTMLElement[], rect: MarqueeRect) => void;
  /** Extra CSS-selector clause prepended to the ignore-list. */
  ignoreSelector?: string;
}): {
  onPointerDown: (e: React.PointerEvent) => void;
  lasso: {
    origin: { x: number; y: number };
    current: { x: number; y: number };
  } | null;
} {
  const [lasso, setLasso] = useState<{
    origin: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const baseIgnore =
    'button, input, textarea, a, select, [role="button"], [data-no-lasso]';

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // Marquee is a mouse/pen interaction — on touch it fights with
    // native scroll and produces a stray lasso rectangle when the user
    // taps anywhere on the body. Reject touch at the hook level so
    // every surface that uses the hook gets the right behavior.
    if (e.pointerType === "touch") return;
    const t = e.target as Element;
    const ignore = opts.ignoreSelector
      ? `${opts.ignoreSelector}, ${baseIgnore}`
      : baseIgnore;
    if (t.closest(ignore)) return;
    originRef.current = { x: e.clientX, y: e.clientY };
    setLasso({
      origin: { x: e.clientX, y: e.clientY },
      current: { x: e.clientX, y: e.clientY },
    });
  }

  useEffect(() => {
    if (!lasso) return;
    function onMove(e: PointerEvent) {
      const origin = originRef.current;
      if (!origin) return;
      setLasso({ origin, current: { x: e.clientX, y: e.clientY } });
      const rect: MarqueeRect = {
        left: Math.min(origin.x, e.clientX),
        top: Math.min(origin.y, e.clientY),
        right: Math.max(origin.x, e.clientX),
        bottom: Math.max(origin.y, e.clientY),
      };
      const els = Array.from(
        document.querySelectorAll<HTMLElement>(optsRef.current.targetSelector),
      );
      const matched = els.filter((el) => {
        const r = el.getBoundingClientRect();
        return !(
          r.right < rect.left ||
          r.left > rect.right ||
          r.bottom < rect.top ||
          r.top > rect.bottom
        );
      });
      optsRef.current.onIntersect(matched, rect);
    }
    function onUp() {
      originRef.current = null;
      setLasso(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [lasso]);

  return { onPointerDown, lasso };
}
