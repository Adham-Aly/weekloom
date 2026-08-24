"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence } from "framer-motion";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

type ConfirmArgs = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Label for an optional "don't ask again" checkbox. When set, the
   *  resolved value carries `dontAskAgain` so the caller can persist
   *  the suppression. */
  dontAskAgainLabel?: string;
};

export type ConfirmResult = { ok: boolean; dontAskAgain: boolean };

type PromptArgs = {
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
};

type ChooseArgs = {
  title: string;
  message?: string;
  /** Radio options, first one preselected. */
  options: Array<{ value: string; label: string }>;
  confirmLabel?: string;
  destructive?: boolean;
};

type Ctx = {
  confirm: (args: ConfirmArgs) => Promise<boolean>;
  /** Like `confirm` but also reports whether the optional
   *  "don't ask again" checkbox was ticked. */
  confirmEx: (args: ConfirmArgs) => Promise<ConfirmResult>;
  prompt: (args: PromptArgs) => Promise<string | null>;
  /** GCal-style radio chooser ("Just this one / all of them"). Resolves the
   *  picked option's value, or null on cancel. */
  choose: (args: ChooseArgs) => Promise<string | null>;
};

const DialogCtx = createContext<Ctx | null>(null);

export function useDialogs() {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error("useDialogs must be inside <DialogProvider>");
  return ctx;
}

type Pending =
  | {
      kind: "confirm";
      args: ConfirmArgs;
      resolve: (v: ConfirmResult) => void;
    }
  | { kind: "prompt"; args: PromptArgs; resolve: (v: string | null) => void }
  | { kind: "choose"; args: ChooseArgs; resolve: (v: string | null) => void };

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirmEx = useCallback(
    (args: ConfirmArgs) =>
      new Promise<ConfirmResult>((resolve) =>
        setPending({ kind: "confirm", args, resolve }),
      ),
    [],
  );
  const confirm = useCallback(
    async (args: ConfirmArgs) => (await confirmEx(args)).ok,
    [confirmEx],
  );
  const prompt = useCallback(
    (args: PromptArgs) =>
      new Promise<string | null>((resolve) =>
        setPending({ kind: "prompt", args, resolve }),
      ),
    [],
  );
  const choose = useCallback(
    (args: ChooseArgs) =>
      new Promise<string | null>((resolve) =>
        setPending({ kind: "choose", args, resolve }),
      ),
    [],
  );

  function close(value: ConfirmResult | string | null) {
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(value as ConfirmResult);
    else pending.resolve(value as string | null);
    setPending(null);
  }

  return (
    <DialogCtx.Provider value={{ confirm, confirmEx, prompt, choose }}>
      {children}
      <AnimatePresence>
        {pending?.kind === "confirm" && (
          <ConfirmDialog
            args={pending.args}
            onResolve={(v: ConfirmResult) => close(v)}
          />
        )}
        {pending?.kind === "prompt" && (
          <PromptDialog args={pending.args} onResolve={(v) => close(v)} />
        )}
        {pending?.kind === "choose" && (
          <ChooseDialog args={pending.args} onResolve={(v) => close(v)} />
        )}
      </AnimatePresence>
    </DialogCtx.Provider>
  );
}

/* ── Shared dialog primitives ─────────────────────────────────────────────
   Visual language: a centered icon in a soft-tinted circle, centered title +
   message, and a row of pill buttons. Destructive actions go red; the primary
   is accent (or red); cancel is a soft neutral pill. */

const DIALOG_CARD = "rounded-2xl";

/** Centered icon medallion at the top of every dialog. */
function DialogIcon({ destructive }: { destructive?: boolean }) {
  return (
    <div
      className={cn(
        "mx-auto flex h-12 w-12 items-center justify-center rounded-full",
        destructive ? "bg-deadline/15 text-deadline" : "bg-accent/15 text-accent",
      )}
    >
      {destructive ? (
        // Trash
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
        </svg>
      ) : (
        // Question mark in nothing — a friendly prompt glyph
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1-1.3 2M12 17h.01" />
        </svg>
      )}
    </div>
  );
}

/** Soft neutral "cancel" pill. */
function CancelButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-lg bg-surface px-5 py-2.5 text-[10.8px] font-semibold text-text-muted transition hover:bg-surface-hover hover:text-text"
    >
      {children}
    </button>
  );
}

/** Filled primary pill — accent normally, red for destructive. */
function PrimaryButton({
  children,
  onClick,
  destructive,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex-1 rounded-lg px-5 py-2.5 text-[10.8px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
        destructive ? "bg-deadline" : "bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function ConfirmDialog({
  args,
  onResolve,
}: {
  args: ConfirmArgs;
  onResolve: (v: ConfirmResult) => void;
}) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  return (
    <Modal
      open
      maxWidth="max-w-sm"
      className={DIALOG_CARD}
      onClose={() => onResolve({ ok: false, dontAskAgain: false })}
    >
      <div className="px-6 pb-6 pt-7 text-center">
        <DialogIcon destructive={args.destructive} />
        <h3 className="mt-4 text-[14.4px] font-semibold leading-snug tracking-tight text-text">
          {args.title}
        </h3>
        {args.message && (
          <p className="mx-auto mt-2 max-w-[18rem] text-[11.2px] leading-relaxed text-text-muted">
            {args.message}
          </p>
        )}

        {args.dontAskAgainLabel && (
          <label className="mt-4 flex cursor-pointer items-center justify-center gap-2.5 text-[11.2px] text-text-muted transition hover:text-text">
            <span
              role="checkbox"
              aria-checked={dontAskAgain}
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                setDontAskAgain((v) => !v);
              }}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  setDontAskAgain((v) => !v);
                }
              }}
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition",
                dontAskAgain
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-border bg-surface hover:border-border-strong",
              )}
            >
              {dontAskAgain && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.5l2.5 2.5L9.5 3.5" />
                </svg>
              )}
            </span>
            {args.dontAskAgainLabel}
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="sr-only"
            />
          </label>
        )}

        <div className="mt-6 flex items-center gap-2.5">
          <CancelButton onClick={() => onResolve({ ok: false, dontAskAgain })}>
            {args.cancelLabel ?? "Cancel"}
          </CancelButton>
          <PrimaryButton
            destructive={args.destructive}
            onClick={() => onResolve({ ok: true, dontAskAgain })}
          >
            {args.confirmLabel ?? "Confirm"}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function ChooseDialog({
  args,
  onResolve,
}: {
  args: ChooseArgs;
  onResolve: (v: string | null) => void;
}) {
  const [selected, setSelected] = useState(args.options[0]?.value ?? "");
  return (
    <Modal
      open
      maxWidth="max-w-sm"
      className={DIALOG_CARD}
      onClose={() => onResolve(null)}
    >
      <div className="px-6 pb-6 pt-7 text-center">
        <DialogIcon destructive={args.destructive} />
        <h3 className="mt-4 text-[14.4px] font-semibold leading-snug tracking-tight text-text">
          {args.title}
        </h3>
        {args.message && (
          <p className="mx-auto mt-2 max-w-[18rem] text-[11.2px] leading-relaxed text-text-muted">
            {args.message}
          </p>
        )}
        <div
          role="radiogroup"
          className="mt-5 flex flex-col gap-1 text-left"
        >
          {args.options.map((o) => {
            const on = o.value === selected;
            return (
              // Notion-style single-select rows: no fake radio circles — the
              // selected row carries a soft fill + an accent check on the
              // right, the app-wide "pick one of several" idiom.
              <button
                key={o.value}
                role="radio"
                aria-checked={on}
                onClick={() => setSelected(o.value)}
                onDoubleClick={() => onResolve(o.value)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[11.7px] transition",
                  on
                    ? "bg-surface font-medium text-text"
                    : "text-text-muted hover:bg-surface/60 hover:text-text",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {on && (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="shrink-0"
                  >
                    <path d="M4.5 12.5l5 5L19.5 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-6 flex items-center gap-2.5">
          <CancelButton onClick={() => onResolve(null)}>Cancel</CancelButton>
          <PrimaryButton
            destructive={args.destructive}
            onClick={() => onResolve(selected)}
          >
            {args.confirmLabel ?? "OK"}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function PromptDialog({
  args,
  onResolve,
}: {
  args: PromptArgs;
  onResolve: (v: string | null) => void;
}) {
  const [value, setValue] = useState(args.initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  function submit() {
    onResolve(value.trim() ? value.trim() : null);
  }

  return (
    <Modal
      open
      maxWidth="max-w-sm"
      className={DIALOG_CARD}
      onClose={() => onResolve(null)}
    >
      <div className="px-6 pb-6 pt-7 text-center">
        <DialogIcon />
        <h3 className="mt-4 text-[14.4px] font-semibold leading-snug tracking-tight text-text">
          {args.title}
        </h3>
        <div className="mt-4 text-left">
          {args.label && (
            <label className="mb-1.5 block text-[9px] uppercase tracking-wider text-text-dim">
              {args.label}
            </label>
          )}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={args.placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-[11.7px] placeholder:text-text-dim focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div className="mt-6 flex items-center gap-2.5">
          <CancelButton onClick={() => onResolve(null)}>Cancel</CancelButton>
          <PrimaryButton onClick={submit} disabled={!value.trim()}>
            {args.confirmLabel ?? "Save"}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
