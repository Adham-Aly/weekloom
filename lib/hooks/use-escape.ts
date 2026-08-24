import { useEffect, useRef } from "react";

/**
 * Shared LIFO stack of active Escape handlers. A single window listener walks
 * the stack from the top (most recently mounted/enabled) and fires only the
 * first one, then stops. This makes nested dismissables behave correctly:
 * pressing Escape with a calendar popover open inside a modal closes only the
 * calendar, not the modal underneath it.
 *
 * Without this, each `useEscape` registered its own window listener, so one
 * Escape press fired *every* active handler at once — closing the popover and
 * the modal that contained it in the same keystroke.
 *
 * Stack entries are stable refs, not the raw callbacks: a consumer that passes
 * an inline `onEscape` (new identity each render) must NOT get re-ordered to
 * the top on every re-render, or a re-render while a child popover is open
 * would steal Escape priority back. The ref keeps the entry's stack position
 * fixed while always invoking the latest callback.
 */
type Entry = { call: () => void };
const handlerStack: Entry[] = [];

function onWindowKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const top = handlerStack[handlerStack.length - 1];
  if (!top) return;
  // Only the topmost handler acts. Capture-phase stopPropagation also keeps
  // bubble-phase window listeners (e.g. the board's global keydown) from
  // reacting while a dismissable is open.
  e.stopPropagation();
  top.call();
}

/**
 * Call `onEscape` when the user presses Escape — but only if this is the
 * topmost active Escape handler (last one mounted with `enabled`). Pass
 * `enabled=false` to leave the stack (e.g. a closed popover).
 */
export function useEscape(onEscape: () => void, enabled: boolean = true) {
  // Always invoke the latest callback without changing the stack entry.
  const cbRef = useRef(onEscape);
  cbRef.current = onEscape;

  useEffect(() => {
    if (!enabled) return;
    const entry: Entry = { call: () => cbRef.current() };
    if (handlerStack.length === 0) {
      // First handler — attach the single shared listener (capture phase).
      window.addEventListener("keydown", onWindowKey, true);
    }
    handlerStack.push(entry);
    return () => {
      const i = handlerStack.lastIndexOf(entry);
      if (i !== -1) handlerStack.splice(i, 1);
      if (handlerStack.length === 0) {
        window.removeEventListener("keydown", onWindowKey, true);
      }
    };
  }, [enabled]);
}
