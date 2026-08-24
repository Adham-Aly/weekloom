"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Modal } from "@/components/ui/modal";
import type { Block, Item } from "@/lib/types/database";
import { addDays, daysBetween, fmtFull, toISODate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useAutoFocus } from "@/lib/hooks/use-auto-focus";

/**
 * Spotlight-style picker: choose which active items have their countdown
 * pinned to the top Deadlines strip.
 */
export function PinDeadlinesModal({
  open,
  items,
  blocks,
  initialPinned,
  onClose,
  onSave,
}: {
  open: boolean;
  items: Item[];
  blocks: Block[];
  initialPinned: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<Set<string>>(new Set(initialPinned));
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset state when reopening
  useEffect(() => {
    if (open) {
      setQuery("");
      setPinned(new Set(initialPinned));
      setCursor(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useAutoFocus(searchRef, open);

  const blocksById = useMemo(
    () => new Map(blocks.map((b) => [b.id, b])),
    [blocks],
  );

  // Only show active items (exclude items in system Completed block)
  const allActive = useMemo(
    () =>
      items.filter(
        (i) => i.block_id !== null && !blocksById.get(i.block_id)?.is_system,
      ),
    [items, blocksById],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allActive;
    return allActive.filter((it) => {
      const block = blocksById.get(it.block_id ?? "");
      return (
        it.title.toLowerCase().includes(q) ||
        block?.name.toLowerCase().includes(q)
      );
    });
  }, [allActive, query, blocksById]);

  function toggle(id: string) {
    setPinned((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function commit() {
    onSave(Array.from(pinned));
    onClose();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (
      e.key === " " ||
      (e.key === "Enter" && !e.metaKey && !e.ctrlKey)
    ) {
      if (filtered[cursor]) {
        e.preventDefault();
        toggle(filtered[cursor].id);
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-xl">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="text-text-dim"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKey}
          placeholder="Search items to track…"
          className="flex-1 bg-transparent text-sm placeholder:text-text-dim focus:outline-none"
        />
        <kbd className="rounded border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-[9px] text-text-dim">
          ↵
        </kbd>
      </div>

      <div className="max-h-[50vh] overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-text-dim">
            No active items match.
          </div>
        ) : (
          filtered.map((it, i) => {
            const block = blocksById.get(it.block_id ?? "");
            const deadlineDate = addDays(
              new Date(it.start_date + "T00:00:00"),
              it.duration_days,
            );
            const dLeft = daysBetween(
              toISODate(new Date()),
              toISODate(deadlineDate),
            );
            const isSelected = pinned.has(it.id);
            return (
              <button
                key={it.id}
                onClick={() => toggle(it.id)}
                onMouseEnter={() => setCursor(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition",
                  i === cursor ? "bg-surface" : "hover:bg-surface/60",
                )}
              >
                <Checkbox checked={isSelected} />
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: block?.color ?? "#71717a" }}
                />
                <span className="min-w-0 flex-1">
                  <div className="truncate text-[11.7px] font-medium text-text">
                    {it.title}
                  </div>
                  <div className="truncate text-[9.9px] text-text-dim">
                    {block?.name ?? "—"} · ends {fmtFull(deadlineDate)}
                  </div>
                </span>
                <DLeftBadge dLeft={dLeft} />
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border bg-bg px-4 py-2.5 text-xs">
        <span className="text-text-dim">
          {pinned.size} pinned ·{" "}
          <kbd className="rounded border border-border-strong bg-bg-elev px-1 py-px font-mono text-[9px]">
            Space
          </kbd>{" "}
          to toggle ·{" "}
          <kbd className="rounded border border-border-strong bg-bg-elev px-1 py-px font-mono text-[9px]">
            ⌘↵
          </kbd>{" "}
          done
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-text-muted hover:bg-surface hover:text-text"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:brightness-110"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <motion.span
      initial={false}
      animate={{
        background: checked ? "var(--accent)" : "transparent",
        borderColor: checked ? "var(--accent)" : "var(--border-strong)",
      }}
      transition={{ duration: 0.1 }}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
    >
      {checked && (
        <svg
          width={9}
          height={9}
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </motion.span>
  );
}

function DLeftBadge({ dLeft }: { dLeft: number }) {
  const overdue = dLeft < 0;
  const today = dLeft === 0;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold tabular-nums",
        overdue
          ? "bg-deadline/20 text-deadline"
          : today
            ? "bg-accent/20 text-accent"
            : "bg-surface text-text-muted",
      )}
    >
      {today ? "today" : overdue ? `+${Math.abs(dLeft)}d late` : `−${dLeft}d`}
    </span>
  );
}
