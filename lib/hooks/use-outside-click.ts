import { useEffect } from "react";

/**
 * Call `onOutside` when a `mousedown` lands outside every passed-in element.
 * Pass the anchor (e.g. the button that opened the popover) and the popover
 * itself so clicks inside either are ignored. `null`/missing refs are skipped.
 */
export function useOutsideClick(
  refs: ReadonlyArray<React.RefObject<HTMLElement | null>>,
  onOutside: () => void,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      for (const ref of refs) {
        if (ref.current?.contains(target)) return;
      }
      onOutside();
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [refs, onOutside, enabled]);
}
