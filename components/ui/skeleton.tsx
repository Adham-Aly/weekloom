import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one placeholder box every route skeleton is built out of.
 *
 * The visual (surface fill + highlight sweep + reduced-motion opt-out) lives
 * in `.wl-skeleton` at the end of app/globals.css rather than in Tailwind
 * utilities, because the sweep needs a ::after pseudo-element.
 *
 * ⚠️ This is deliberately NOT the `animate-pulse` idiom used by the in-place
 * loaders that sit inside an already-painted page, where a quiet opacity
 * throb is right; a full-screen route skeleton reads as a broken render if
 * nothing travels across it.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("wl-skeleton rounded-md", className)} style={style} />
  );
}

/**
 * Root wrapper for a whole-route skeleton. Owns the accessibility story so no
 * individual skeleton has to: one polite status message instead of a screen
 * reader walking dozens of empty boxes.
 */
export function SkeletonScreen({
  label,
  className,
  style,
  children,
}: {
  /** Announced to assistive tech, e.g. "Loading your board". */
  label: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className} style={style}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * A stack of text-line placeholders with a short last line, which is what
 * makes a block read as prose rather than as a solid slab.
 */
export function SkeletonLines({
  count = 3,
  className,
  lineClassName = "h-3",
}: {
  count?: number;
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className={cn(lineClassName, i === count - 1 ? "w-2/5" : "w-full")}
        />
      ))}
    </div>
  );
}
