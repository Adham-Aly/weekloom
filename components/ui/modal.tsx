"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEscape } from "@/lib/hooks/use-escape";

export function Modal({
  open,
  onClose,
  children,
  className,
  maxWidth = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}) {
  useEscape(onClose, open);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{
        backdropFilter: "blur(12px) saturate(140%)",
        WebkitBackdropFilter: "blur(12px) saturate(140%)",
      }}
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[20vh]"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: -6, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: -6, scale: 0.97, opacity: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        style={{
          // Frosted glass — matches the calendar's popovers / quick-create card.
          background: "var(--frost, var(--bg-elev))",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
        }}
        className={cn(
          "w-full overflow-hidden rounded-2xl border border-border-strong shadow-2xl shadow-black/40",
          maxWidth,
          className,
        )}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function ModalHeader({ title }: { title: string }) {
  return (
    <div className="px-6 pt-5 pb-1">
      <h3 className="text-[13.5px] font-semibold tracking-tight text-text">
        {title}
      </h3>
    </div>
  );
}

export function ModalFooter({
  onCancel,
  onConfirm,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  disabled,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-end gap-2.5 px-6 pb-5 pt-2"
      style={{ borderTop: "1px solid color-mix(in srgb, var(--text) 8%, transparent)" }}
    >
      <button
        onClick={onCancel}
        className="rounded-lg bg-surface px-5 py-2 text-[11.7px] font-semibold text-text-muted transition hover:bg-surface-hover hover:text-text"
      >
        {cancelLabel}
      </button>
      <button
        onClick={onConfirm}
        disabled={disabled}
        className={cn(
          "rounded-lg px-5 py-2 text-[11.7px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
          destructive ? "bg-deadline" : "bg-accent",
        )}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
