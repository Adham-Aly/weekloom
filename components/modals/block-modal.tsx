"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { BlockIconGrid, BlockIcon } from "@/components/modals/block-icon-picker";
import { cn } from "@/lib/utils";
import type { Block } from "@/lib/types/database";

const SWATCHES = [
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#7c6cff",
  "#3b82f6",
  "#0f7a55",
  "#52525b",
];

export function BlockModal({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: Block;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    color: string;
    icon: string | null;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? SWATCHES[0]);
  const [icon, setIcon] = useState<string | null>(initial?.icon ?? null);
  const [iconOpen, setIconOpen] = useState(false);

  // Reset state on each open so editing block B doesn't show block A's fields.
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setColor(initial?.color ?? SWATCHES[0]);
      setIcon(initial?.icon ?? null);
      setIconOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  function submit() {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), color, icon });
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title={initial ? "Edit block" : "New block"} />
      <div className="px-6 py-3 space-y-4">
        {/* Name with an inline icon button on the left (Notion-style). */}
        <div className="space-y-1.5">
          <label className="block text-[8.1px] font-semibold uppercase tracking-widest text-text-dim">
            Name
          </label>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIconOpen((v) => !v)}
              title="Choose an icon"
              className={cn(
                "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border transition",
                iconOpen
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text",
              )}
              style={icon ? { color } : undefined}
            >
              {icon ? (
                <BlockIcon name={icon} size={18} />
              ) : (
                // Smiley face — an obvious "set an icon" affordance.
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8.5 14.5a4 4 0 0 0 7 0" />
                  <path d="M9 9.5h.01M15 9.5h.01" />
                </svg>
              )}
            </button>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. General School Tasks"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="h-[38px] w-full rounded-xl border border-border bg-surface px-3.5 text-[11.7px] placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Inline icon grid — expands when the icon button is clicked. */}
        <AnimatePresence>
          {iconOpen && (
            <motion.div
              key="icon-grid"
              initial={{ opacity: 0, scale: 0.97, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -6 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              className="rounded-xl border border-border bg-surface/60 p-2"
            >
              <BlockIconGrid
                value={icon}
                onPick={(name) => {
                  setIcon(name);
                  setIconOpen(false);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-1.5">
          <label className="block text-[8.1px] font-semibold uppercase tracking-widest text-text-dim">
            Color
          </label>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((s) => (
              <button
                key={s}
                onClick={() => setColor(s)}
                aria-label={s}
                className="h-7 w-7 rounded-full transition hover:brightness-110"
                style={{
                  background: s,
                  boxShadow:
                    color === s
                      ? "0 0 0 2px var(--bg-elev), 0 0 0 4px " + s
                      : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={submit}
        confirmLabel={initial ? "Save" : "Create"}
        disabled={!name.trim()}
      />
    </Modal>
  );
}
