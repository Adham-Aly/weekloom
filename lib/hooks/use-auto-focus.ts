import { useEffect } from "react";

/**
 * Focus a ref'd element shortly after `open` flips true. The small delay
 * (60ms by default) lets the modal's enter animation paint before stealing
 * focus — otherwise the focus ring flashes mid-transition.
 */
export function useAutoFocus(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  delayMs: number = 60,
) {
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => ref.current?.focus(), delayMs);
    return () => clearTimeout(id);
  }, [open, ref, delayMs]);
}
