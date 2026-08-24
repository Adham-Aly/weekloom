"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { BlockIcon } from "@/components/modals/block-icon-picker";
import { useAutoFocus } from "@/lib/hooks/use-auto-focus";
import type { Block, Deadline, Item, Step } from "@/lib/types/database";
import { cn } from "@/lib/utils";

/**
 * Vanilla word/substring search across the user's chart. Vector embeddings
 * would be overkill at this scale — title-style content with short labels
 * ranks well on token-overlap matching.
 *
 * Hit kinds:
 *   item     → opens the item editor
 *   step     → opens its parent item's editor (no in-place step focus yet)
 *   block    → scrolls the block into view (no-op for now: returns block id)
 *   deadline → no callback yet; surfaced for visibility only
 *
 * Ranking: exact title match → starts-with → contains. Stable within tier.
 */
type Hit =
  | { kind: "item"; item: Item; block: Block; score: number }
  | {
      kind: "step";
      step: Step;
      item: Item;
      block: Block;
      score: number;
    }
  | { kind: "block"; block: Block; score: number }
  | { kind: "deadline"; deadline: Deadline; score: number };

function scoreMatch(text: string, q: string): number {
  const t = text.toLowerCase();
  if (!t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 75;
  // Word-boundary > mid-word.
  const wb = new RegExp(`\\b${escapeRegex(q)}`, "i").test(text);
  if (wb) return 55;
  if (t.includes(q)) return 30;
  return 0;
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function SearchModal({
  open,
  blocks,
  items,
  steps,
  deadlines,
  onClose,
  onJumpToItem,
  onJumpToBlock,
}: {
  open: boolean;
  blocks: Block[];
  items: Item[];
  steps: Step[];
  deadlines: Deadline[];
  onClose: () => void;
  /**
   * Scroll to the item in the Gantt and flash-highlight its row.
   * `focusDate` is the date to centre horizontally on (e.g. the step's
   * computed date for a step hit). When omitted the caller uses the
   * item's start_date.
   */
  onJumpToItem: (item: Item, focusDate?: string) => void;
  /** Scroll to the block in the Gantt and flash its first item. */
  onJumpToBlock: (block: Block) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useAutoFocus(inputRef, open);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  const blocksById = useMemo(
    () => new Map(blocks.map((b) => [b.id, b])),
    [blocks],
  );
  const itemsById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );
  // Items whose every step is done are hidden from the board (they fold into
  // the Completed section — board.tsx `allDone` filter). Search mirrors the
  // board, so these must not surface as hits. Matches the board's rule exactly:
  // an item with zero steps is NOT complete.
  const completedItemIds = useMemo(() => {
    const total = new Map<string, number>();
    const done = new Map<string, number>();
    for (const s of steps) {
      total.set(s.item_id, (total.get(s.item_id) ?? 0) + 1);
      if (s.status === "done")
        done.set(s.item_id, (done.get(s.item_id) ?? 0) + 1);
    }
    const set = new Set<string>();
    for (const [id, n] of total) if (n > 0 && done.get(id) === n) set.add(id);
    return set;
  }, [steps]);

  const hits: Hit[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Hit[] = [];

    for (const b of blocks) {
      if (b.is_system) continue;
      const s = scoreMatch(b.name, q);
      if (s > 0) out.push({ kind: "block", block: b, score: s });
    }
    for (const it of items) {
      const b = blocksById.get(it.block_id ?? "");
      if (!b || b.is_system) continue;
      // Completed tasks leave the board, so they must not appear in search.
      if (completedItemIds.has(it.id)) continue;
      const s = scoreMatch(it.title, q);
      if (s > 0) out.push({ kind: "item", item: it, block: b, score: s });
    }
    for (const st of steps) {
      if (!st.label.trim()) continue;
      // Done steps live in the Completed section, not on the board.
      if (st.status === "done") continue;
      const it = itemsById.get(st.item_id);
      if (!it) continue;
      const b = blocksById.get(it.block_id ?? "");
      if (!b || b.is_system) continue;
      const s = scoreMatch(st.label, q) * 0.85; // outrank steps below items
      if (s > 0)
        out.push({ kind: "step", step: st, item: it, block: b, score: s });
    }
    for (const d of deadlines) {
      const s = scoreMatch(d.name, q);
      if (s > 0) out.push({ kind: "deadline", deadline: d, score: s });
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 50);
  }, [
    query,
    blocks,
    items,
    steps,
    deadlines,
    blocksById,
    itemsById,
    completedItemIds,
  ]);

  useEffect(() => setCursor(0), [query]);

  function commit(hit: Hit) {
    onClose();
    if (hit.kind === "item") onJumpToItem(hit.item);
    else if (hit.kind === "step") {
      // Use the step's computed date so a step on today scrolls to today,
      // not to the item's possibly-far-past start_date.
      const focusDate = stepDate(hit.step, hit.item);
      onJumpToItem(hit.item, focusDate);
    } else if (hit.kind === "block") onJumpToBlock(hit.block);
    // deadlines: no-op for now (surface only).
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(hits.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[cursor];
      if (hit) commit(hit);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg">
      <div className="border-b border-border px-4 py-3">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search items, steps, blocks…"
          className="w-full bg-transparent text-[12.6px] text-text placeholder:text-text-dim focus:outline-none"
        />
      </div>

      <div className="max-h-[360px] overflow-y-auto py-1">
        {query.trim() && hits.length === 0 && (
          <div className="px-5 py-8 text-center text-[10.8px] italic text-text-dim">
            No matches for “{query}”.
          </div>
        )}
        {!query.trim() && (
          <div className="px-5 py-8 text-center text-[10.8px] italic text-text-dim">
            Start typing to search across items, steps, blocks, and deadlines.
          </div>
        )}
        {hits.map((hit, i) => (
          <HitRow
            key={hitKey(hit)}
            hit={hit}
            active={i === cursor}
            onHover={() => setCursor(i)}
            onPick={() => commit(hit)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border bg-bg px-4 py-2 text-[9.5px] text-text-dim">
        <span>
          {hits.length} {hits.length === 1 ? "match" : "matches"}
        </span>
        <span className="font-mono">↑↓ navigate · ↵ open · esc close</span>
      </div>
    </Modal>
  );
}

function stepDate(step: Step, item: Item): string {
  // Same math as lib/gantt/layout/isoAtOffset, inlined to avoid the
  // dependency here. Local-midnight Date construction + addDays + format.
  const d = new Date(item.start_date + "T00:00:00");
  d.setDate(d.getDate() + step.day_offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hitKey(hit: Hit): string {
  switch (hit.kind) {
    case "item":
      return `i:${hit.item.id}`;
    case "step":
      return `s:${hit.step.id}`;
    case "block":
      return `b:${hit.block.id}`;
    case "deadline":
      return `d:${hit.deadline.id}`;
  }
}

function HitRow({
  hit,
  active,
  onHover,
  onPick,
}: {
  hit: Hit;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const color =
    hit.kind === "deadline"
      ? "var(--deadline-text)"
      : hit.kind === "item"
        ? (hit.item.color ?? hit.block.color)
        : hit.kind === "step"
          ? (hit.item.color ?? hit.block.color)
          : hit.block.color;

  return (
    <button
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-2.5 px-4 py-2 text-left transition",
        active ? "bg-accent/15" : "hover:bg-surface",
      )}
    >
      {hit.kind === "deadline" ? (
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px]"
          style={{ color }}
          aria-hidden
        >
          🚩
        </span>
      ) : hit.kind === "block" ? (
        hit.block.icon ? (
          <BlockIcon name={hit.block.icon} size={14} color={color} />
        ) : (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: color }}
          />
        )
      ) : // item or step — show parent block icon (or dot fallback)
      hit.block.icon ? (
        <BlockIcon name={hit.block.icon} size={14} color={color} />
      ) : (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color }}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.7px] text-text">
          {hit.kind === "item" && hit.item.title}
          {hit.kind === "step" && (
            <>
              {hit.step.label || "(no label)"}{" "}
              <span className="text-text-dim">·</span>{" "}
              <span className="text-text-muted">{hit.item.title}</span>
            </>
          )}
          {hit.kind === "block" && hit.block.name}
          {hit.kind === "deadline" && hit.deadline.name}
        </div>
        <div className="text-[9.9px] text-text-dim">
          {hit.kind === "item" && `Item · ${hit.block.name}`}
          {hit.kind === "step" && `Step · ${hit.block.name}`}
          {hit.kind === "block" && "Block"}
          {hit.kind === "deadline" && `Deadline · ${hit.deadline.date}`}
        </div>
      </div>
    </button>
  );
}
