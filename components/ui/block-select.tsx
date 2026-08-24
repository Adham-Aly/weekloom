"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEscape } from "@/lib/hooks/use-escape";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import type { Block } from "@/lib/types/database";

/**
 * A Notion-style block picker: a calm button showing the current block (colored
 * square + name), opening a dropdown of blocks — each a colored square + name,
 * a checkmark on the active one. Replaces the old coloured-dot pill row.
 *
 * The menu is rendered FIXED to the viewport (not nested in the button's flow)
 * so it escapes the parent popover's `overflow-hidden`, and it flips above the
 * button when there isn't room below.
 */
export function BlockSelect({
  blocks,
  currentBlockId,
  onChange,
  placeholder = "No block",
  allowNone = false,
}: {
  blocks: Block[];
  currentBlockId?: string;
  onChange: (blockId: string) => void;
  placeholder?: string;
  /** Render a "No block" entry that clears the selection (calls onChange("")). */
  allowNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    origin: "top" | "bottom";
  } | null>(null);

  useOutsideClick([btnRef, menuRef], () => setOpen(false));
  // ⚠️ Only while the dropdown is open — see the note on `ViewMenu` in
  // board.tsx. This control is mounted for as long as the modal or popover
  // holding it, and `useEscape`'s stack position is fixed at REGISTRATION.
  // Effects run child-first, so registering at mount pinned this entry BELOW
  // its own modal's and left it there — and opening the dropdown could not
  // move it up. Escape inside an open dropdown therefore dismissed the whole
  // modal instead of just the dropdown, which is precisely the nesting the
  // shared stack exists to get right. Gating on `open` fixes both ends: a
  // closed dropdown occupies no slot, and an open one is pushed last.
  useEscape(() => setOpen(false), open);

  // Measure the button and place the menu just below it, flipping above when it
  // would overflow the viewport bottom. Row height ≈ 32px + 8px padding.
  useLayoutEffect(() => {
    if (!open) return;
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const gap = 6;
    const estH = Math.min((blocks.length + (allowNone ? 1 : 0)) * 32 + 8, 264);
    const below = window.innerHeight - r.bottom - 8;
    const flip = below < estH && r.top - 8 > below;
    setPos({
      left: r.left,
      width: r.width,
      top: flip ? r.top - gap : r.bottom + gap,
      origin: flip ? "bottom" : "top",
    });
  }, [open, blocks.length]);

  const current = blocks.find((b) => b.id === currentBlockId);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2 text-left transition hover:bg-surface"
      >
        {current ? (
          <>
            <ColorDot color={current.color} />
            <span className="min-w-0 flex-1 truncate text-[11.7px] text-text">
              {current.name}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11.7px] text-text-dim">
            {placeholder}
          </span>
        )}
        <Chevron open={open} />
      </button>

      {mounted &&
        createPortal(
          // Portal-on-the-outside, AnimatePresence-inside: AnimatePresence can't
          // track a portal as its child, so it must live INSIDE the portal.
          // Portalling to <body> also escapes the parent popover's framer-motion
          // transform — a `position: fixed` child of a transformed ancestor
          // resolves against that ancestor, not the viewport, so it lands
          // off-screen otherwise. This fixes positioning AND z-index.
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={menuRef}
                // stopPropagation on mousedown keeps the parent popover's
                // outside-click (window mousedown) from treating a pick as
                // "outside" and closing the whole panel.
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.98, y: pos.origin === "top" ? -4 : 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: pos.origin === "top" ? -4 : 4 }}
            transition={{ duration: 0.1, ease: "easeOut" }}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              ...(pos.origin === "top"
                ? { top: pos.top }
                : { bottom: window.innerHeight - pos.top }),
              zIndex: 300,
              background: "var(--frost, var(--bg-elev))",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              border: "1px solid color-mix(in srgb, var(--text) 12%, transparent)",
              transformOrigin: pos.origin === "top" ? "top" : "bottom",
            }}
            className="max-h-64 overflow-y-auto rounded-xl p-1 shadow-2xl shadow-black/40"
          >
            {allowNone && (
              <button
                onClick={() => {
                  if (currentBlockId) onChange("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-surface"
              >
                <span className="h-3 w-3 shrink-0 rounded-[4px] border border-border-strong" aria-hidden />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[11.7px]",
                    !currentBlockId ? "text-text" : "text-text-muted",
                  )}
                >
                  No block
                </span>
                {!currentBlockId && <Check />}
              </button>
            )}
            {blocks.map((b) => {
              const active = b.id === currentBlockId;
              return (
                <button
                  key={b.id}
                  onClick={() => {
                    if (!active) onChange(b.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-surface"
                >
                  <ColorDot color={b.color} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[11.7px]",
                      active ? "text-text" : "text-text-muted",
                    )}
                  >
                    {b.name}
                  </span>
                  {active && <Check />}
                </button>
              );
            })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="h-3 w-3 shrink-0 rounded-[4px]"
      style={{ background: color }}
      aria-hidden
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0 text-text-dim transition", open && "rotate-180")}
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text" aria-hidden>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}
