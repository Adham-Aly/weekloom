"use client";

import { useEffect, useState } from "react";
import {
  BREAKPOINTS,
  type ViewportKind,
  viewportFromWidth,
} from "@/lib/responsive/breakpoints";

export type Viewport = {
  width: number;
  height: number;
  kind: ViewportKind;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
};

/**
 * Server-render fallback. Defaults to desktop so SSR markup matches the
 * 90%+ desktop traffic we expect — phones get a one-frame hydration
 * correction, which is cheaper than the inverse.
 */
const SSR_FALLBACK: Viewport = {
  width: 1440,
  height: 900,
  kind: "desktop",
  isMobile: false,
  isTablet: false,
  isDesktop: true,
};

function snapshot(): Viewport {
  if (typeof window === "undefined") return SSR_FALLBACK;
  const { innerWidth: width, innerHeight: height } = window;
  const kind = viewportFromWidth(width);
  return {
    width,
    height,
    kind,
    isMobile: kind === "mobile",
    isTablet: kind === "tablet",
    isDesktop: kind === "desktop",
  };
}

/**
 * Subscribe to the current viewport. Re-renders on resize using a
 * matchMedia listener (cheaper than a `resize` poll — fires only when
 * crossing a breakpoint). Always returns the same `Viewport` shape so
 * consumers don't have to null-check.
 */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(snapshot);

  useEffect(() => {
    function update() {
      setVp(snapshot());
    }
    // Initial sync (in case SSR fallback was wrong).
    update();
    // matchMedia listeners fire on breakpoint crossings — cheaper than
    // a `resize` handler that fires on every pixel of drag.
    const mobileMq = window.matchMedia(
      `(max-width: ${BREAKPOINTS.mobile - 1}px)`,
    );
    const desktopMq = window.matchMedia(
      `(min-width: ${BREAKPOINTS.desktop}px)`,
    );
    mobileMq.addEventListener("change", update);
    desktopMq.addEventListener("change", update);
    // Still listen to plain resize so width/height stay current within
    // a single breakpoint (used for layout math like `gridWidth`).
    window.addEventListener("resize", update);
    return () => {
      mobileMq.removeEventListener("change", update);
      desktopMq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return vp;
}
