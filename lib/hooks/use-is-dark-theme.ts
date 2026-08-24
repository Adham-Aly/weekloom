import { useEffect, useState } from "react";

/**
 * Live theme detection — watches the `data-theme` attribute on `<html>` so it
 * updates instantly when the user toggles theme, regardless of whether settings
 * has been saved to DB yet. Returns `true` when the theme is anything other than
 * an explicit "light" (i.e. dark is the default).
 *
 * SSR-safe: the initial value falls back to dark when `document` is unavailable.
 */
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.dataset.theme !== "light"
      : true,
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.dataset.theme !== "light"),
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);
  return isDark;
}
