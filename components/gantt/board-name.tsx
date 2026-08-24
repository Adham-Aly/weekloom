"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Inline-editable board name for the TopBar — sits where the user email used
 * to render (top-right). Click to rename: the static label swaps for a text
 * input pre-filled with the current name. Enter / blur commits via `onRename`;
 * Escape cancels and restores the prior value. A blank commit is allowed (the
 * parent normalizes it to "Untitled Board"), so the placeholder mirrors that
 * default.
 *
 * Presentational only — the parent (`GanttBoard`) owns the optimistic state
 * and the `updateBoard` persistence. When `disabled` (e.g. /demo) the control
 * is read-only: it renders the name but never enters edit mode.
 */
export function BoardName({
  name,
  onRename,
  disabled = false,
}: {
  /** The active board's current name (empty string renders as the default). */
  name: string;
  /** Commit a new name. The parent trims + defaults blanks to "Untitled Board". */
  onRename: (name: string) => void;
  /** Read-only mode (demo) — clicking never opens the editor. */
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync when the name changes from outside edit mode
  // (e.g. an undo, or a server echo). Avoid clobbering an in-progress edit.
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  // Focus + select the text when entering edit mode so a rename is a single
  // gesture (click → type to replace).
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const display = name.trim() || "Untitled Board";

  function commit() {
    setEditing(false);
    if (draft !== name) onRename(draft);
  }
  function cancel() {
    setDraft(name);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder="Untitled Board"
        maxLength={200}
        aria-label="Board name"
        className="w-44 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text outline-none focus:border-accent"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) setEditing(true);
      }}
      title={disabled ? display : "Rename board"}
      className={cn(
        "max-w-[12rem] truncate rounded-md px-2 py-0.5 text-xs text-text-muted transition",
        !disabled && "hover:bg-surface hover:text-text",
        disabled && "cursor-default",
        !name.trim() && "italic text-text-dim",
      )}
    >
      {display}
    </button>
  );
}
