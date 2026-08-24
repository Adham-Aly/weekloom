import { useEffect, useRef } from "react";

/**
 * Run `flush` when this component unmounts, and when the page itself is going
 * away.
 *
 * ═══ WHY THIS EXISTS ═══════════════════════════════════════════════════════
 *
 * Two surfaces in this app auto-save on a 400 ms debounce — the board's
 * eight-key settings patch and the Settings form's delta — and a debounce whose
 * only teardown is `clearTimeout` **throws away whatever was still pending**.
 * MEASURED, on the real standalone build, with this hook removed from both
 * callers and nothing else changed: expand a task's steps and click "Settings"
 * inside the same window before the timer fires, and **no Server Action is
 * issued at all** — the board comes back collapsed. Nothing errors, nothing
 * logs, and the interface showed the new value the whole time; it is the same
 * silent class of loss as a rejected write that is never rolled back.
 *
 * Both callers already hold a "what the server is known to have" baseline, so
 * the flush they pass is a no-op when the debounce already fired. That is
 * required rather than tidy: `pagehide` and unmount can BOTH fire for one
 * departure, and the flush must not turn that into two writes.
 *
 * ⚠️ **Unmount is the leg that is actually guaranteed.** A route change inside
 * the window (board → Settings → board is the common one) unmounts the
 * component while the document lives on, so the write goes out on a page that
 * is still there to see it fail. `pagehide` covers a reload and a window close
 * on a best-effort basis only: the request is dispatched, but a renderer that
 * is being torn down may be gone before the socket flushes, and no Server
 * Action can be sent through `navigator.sendBeacon` (it cannot set the
 * `Next-Action` header). MEASURED over repeated attempts on the standalone
 * build: a window CLOSE kept the value 10/10 and a board RELOAD 10/10, but a
 * reload of the Settings page kept it only **15/20** — a quarter of those
 * departures still lost the write. So this narrows the loss window from "any
 * departure" to "some reloads inside the last 400 ms"; it does not close it,
 * and it must not be written up as though it did.
 *
 * The callback is held in a ref and re-read on every render, so the effect
 * registers once and still flushes the LATEST state — the same idiom
 * `lib/hooks/use-escape.ts` uses, and for the same reason: an inline callback
 * has a new identity every render and re-subscribing on each one would reset
 * the listener constantly.
 */
export function useFlushOnUnload(flush: () => void) {
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const run = () => flushRef.current();
    // `pagehide` rather than `beforeunload`: it fires on a reload and on a
    // window close without the "leave site?" prompt semantics, and it is the
    // one the spec still recommends for save-on-exit.
    window.addEventListener("pagehide", run);
    return () => {
      window.removeEventListener("pagehide", run);
      run();
    };
  }, []);
}
