"use client";

import { useEffect } from "react";

/**
 * Applies the user's accent colour as a CSS variable on `<html>`, so every
 * `var(--accent)` consumer picks it up immediately — including portals and
 * modals that render to `<body>` and would miss a scoped provider.
 *
 * Runs on the client only and renders nothing. The hex shape is validated
 * here as well as at the settings boundary: this value is written straight
 * into a style property, so it is worth checking twice.
 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function deriveAccentDim(hex: string): string {
  // Darken by ~12% for the --accent-dim variable. Keep it crude — the
  // user picked the accent, they tolerate a derived hover shade.
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) - 22);
  const g = Math.max(0, ((n >> 8) & 0xff) - 22);
  const b = Math.max(0, (n & 0xff) - 22);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function Personalization({ accentColor }: { accentColor: string }) {
  useEffect(() => {
    const root = document.documentElement;
    if (accentColor && HEX_RE.test(accentColor)) {
      root.style.setProperty("--accent", accentColor);
      root.style.setProperty("--accent-dim", deriveAccentDim(accentColor));
    } else {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-dim");
    }
  }, [accentColor]);

  return null;
}
