"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useEscape } from "@/lib/hooks/use-escape";
import type { Board } from "@/lib/types/database";
import { updateSettings } from "@/app/actions";
import type { HomeStats, BoardMeta } from "@/app/actions";
import { Plus, Trash, ChevronRight, ChevronLeft } from "@/components/icons";
import { BlockIcon } from "@/components/modals/block-icon-picker";
import { LogoMark } from "@/components/ui/logo-mark";
import { useMenu } from "@/components/ui/context-menu";
import { PRODUCT_NAME } from "@/lib/brand";

/**
 * The Drive-style HOME SCREEN — Weekloom's landing surface.
 *
 * Aesthetic: matches the Gantt board exactly — FLAT. Solid dark surfaces, no
 * gradients/glows/blur. Each board card is treated like a task bar: a solid
 * swatch of the board's colour with the app's signature 135° diagonal hatch
 * (`repeating-linear-gradient(135deg, rgba(0,0,0,0.12) 0 1px, transparent
 * 1px 8px)`) and a thin matching border. The header carries the same controls
 * as the in-app TopBar (theme + settings), plus Trash on the board list.
 *
 * Presentational apart from the theme toggle, which persists the choice to
 * `user_settings` itself (see {@link ThemeToggle}); everything else is wired by
 * the parent — `onCreate` to the createBoard action, and the accent colour by
 * the `<Personalization>` its parent mounts.
 */

const DEFAULT_BOARD_COLOR = "#3b82f6";
const DEFAULT_BOARD_NAME = "Untitled Board";

/** The app's signature diagonal hatch (same as task bars / block headers). */
const HATCH =
  "repeating-linear-gradient(135deg, rgba(0,0,0,0.12) 0 1px, transparent 1px 8px)";

export function BoardHome({
  boards,
  activeBoardId,
  stats,
  initialTheme,
  onCreate,
  onEdit,
  onTrash,
  onRestore,
  onDeleteForever,
}: {
  boards: Board[];
  activeBoardId?: string | null;
  /** "Your week" rollup + recent activity, derived from completed steps. */
  stats: HomeStats;
  /** The stored theme, straight from `user_settings`. ⚠️ The row is
   *  authoritative and `localStorage` is only the pre-paint cache, so this is
   *  what the toggle below starts from — see {@link ThemeToggle}. */
  initialTheme: "dark" | "light";
  onCreate: (name: string) => void;
  /** Open the edit modal for a board (name / icon / colour). */
  onEdit?: (board: Board) => void;
  /** Archive a board (move to trash) — reversible. */
  onTrash?: (board: Board) => void;
  /** Un-archive a board from the trash. */
  onRestore?: (board: Board) => void;
  /** Permanently delete a board (cascades its data). Confirmed by the parent. */
  onDeleteForever?: (board: Board) => void;
}) {
  const active = boards.filter((b) => !b.archived);
  const trashed = boards.filter((b) => b.archived);

  const [view, setView] = useState<"boards" | "trash">("boards");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const openCreate = useCallback(() => {
    setName("");
    setCreating(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const cancelCreate = useCallback(() => {
    setCreating(false);
    setName("");
  }, []);

  const submitCreate = useCallback(() => {
    const trimmed = name.trim();
    onCreate(trimmed.length > 0 ? trimmed : DEFAULT_BOARD_NAME);
    setCreating(false);
    setName("");
  }, [name, onCreate]);

  useEscape(cancelCreate, creating);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      {/* ── Header: mirrors the in-app TopBar ──────────────────────── */}
      <header className="sticky top-0 z-50 flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg-elev px-4">
        <div className="flex items-center gap-2">
          <LogoMark />
          <h1 className="text-sm font-medium tracking-tight">{PRODUCT_NAME}</h1>
          <span className="text-xs text-text-dim">/</span>
          {view === "trash" ? (
            <button
              onClick={() => setView("boards")}
              title="Back to boards"
              className="flex items-center gap-1 rounded-md py-0.5 pl-1 pr-2 text-xs text-text-muted transition hover:bg-surface hover:text-text"
            >
              <ChevronLeft width={14} height={14} />
              Trash
            </button>
          ) : (
            <span className="text-xs text-text-muted">Boards</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {view === "boards" ? (
            <button
              onClick={() => setView("trash")}
              title={trashed.length > 0 ? `Trash (${trashed.length})` : "Trash"}
              // ⚠️ `aria-label`, because `title` is only the accessible name
              // when the element has NO text content — and this button renders
              // its count as text. MEASURED: with the badge showing, a screen
              // reader announced this button as "1". The label carries the
              // count so nothing is lost by hiding the badge from the tree.
              aria-label={
                trashed.length > 0 ? `Trash (${trashed.length})` : "Trash"
              }
              className="relative flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition hover:bg-surface hover:text-text"
            >
              <Trash width={15} height={15} />
              {trashed.length > 0 ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[8.1px] font-bold leading-none text-white"
                >
                  {trashed.length}
                </span>
              ) : null}
            </button>
          ) : null}
          <ThemeToggle initial={initialTheme} />
          <Link
            href="/settings"
            title="Settings"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition hover:bg-surface hover:text-text"
          >
            <GearIcon />
          </Link>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-20 sm:px-8">
        {view === "boards" ? (
          <>
            {/* "Your week" summary — real, recognisable metrics. */}
            <WeekSummary stats={stats} />

            {/* Quick access: ALL boards as cards. */}
            <div className="mb-4 mt-12 flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight text-text">
                Quick access
              </h2>
              {!creating ? (
                <button
                  onClick={openCreate}
                  className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[11.7px] font-semibold text-white transition hover:brightness-110"
                >
                  <Plus width={14} height={14} />
                  New board
                </button>
              ) : null}
            </div>

            <AnimatePresence initial={false}>
              {creating ? (
                <NewBoardInputRow
                  key="create-row"
                  ref={inputRef}
                  value={name}
                  onChange={setName}
                  onSubmit={submitCreate}
                  onCancel={cancelCreate}
                />
              ) : null}
            </AnimatePresence>

            <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((board) => (
                <BoardCard
                  key={board.id}
                  board={board}
                  isActive={board.id === activeBoardId}
                  meta={stats.boardMeta[board.id]}
                  onEdit={onEdit}
                  onTrash={onTrash}
                />
              ))}
              {/* Hollow "add board" card — redundant with the header button,
                  but the dashed empty slot keeps the grid rhythm and gives the
                  gesture a target where the eye already is. */}
              <button
                type="button"
                onClick={openCreate}
                className="group flex min-h-[136px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong text-text-muted transition hover:border-accent/50 hover:text-text"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface transition group-hover:scale-110">
                  <Plus width={18} height={18} />
                </span>
                <span className="text-[11.7px] font-medium">Add board</span>
              </button>
            </div>

            {/* Recent: the same boards as a detailed list with Last edited. */}
            <h2 className="mb-3 mt-12 text-base font-semibold tracking-tight text-text">
              Recent
            </h2>
            <div className="overflow-hidden rounded-xl border border-border bg-bg-elev">
              {[...active]
                .sort((a, b) => {
                  const au = stats.boardMeta[a.id]?.updatedAt ?? "";
                  const bu = stats.boardMeta[b.id]?.updatedAt ?? "";
                  return bu.localeCompare(au);
                })
                .map((board, i) => (
                  <BoardRow
                    key={board.id}
                    board={board}
                    isActive={board.id === activeBoardId}
                    meta={stats.boardMeta[board.id]}
                    first={i === 0}
                    onEdit={onEdit}
                    onTrash={onTrash}
                  />
                ))}
            </div>
          </>
        ) : (
          <TrashView
            trashed={trashed}
            onRestore={onRestore}
            onDeleteForever={onDeleteForever}
          />
        )}
      </main>
    </div>
  );
}

/* ── "Your week" summary ──────────────────────────────────────────── */

function fmtHours(min: number): string {
  if (min <= 0) return "0";
  const h = min / 60;
  if (h < 1) return `${min}m`;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

/**
 * "Your week" summary — heading + a row of standalone stat cards (Donezo
 * style): each card has its figure top-left and an icon medallion top-right,
 * with the label beneath. Real metrics people recognise: what they checked
 * off, the focused time it represents, and how many days they showed up.
 */
function WeekSummary({ stats }: { stats: HomeStats }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-text">
        Your boards
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Here&apos;s your summary for the week.
      </p>
      <CompletionChart stats={stats} className="mt-5" />
    </section>
  );
}

/**
 * "Tasks completed" panel. Header carries quiet analytics figures + a
 * Weekloom/Git view toggle. Below: a ~65% chart on the left (dense dot-density
 * columns in Weekloom mode, or a GitHub-style contribution grid in Git mode)
 * and a ~35% block-focus radar on the right showing which block you've put the
 * most completed work into. All hand-built divs/SVG — no charting library.
 */
function CompletionChart({
  stats,
  className,
}: {
  stats: HomeStats;
  className?: string;
}) {
  const total = stats.daily.reduce((s, d) => s + d.count, 0);

  return (
    <div className={cn("space-y-4", className)}>
      {/* The contribution grid, unbound — no card, no heading, blends into
          the page background so the grid itself is the only thing on screen. */}
      <div className="flex flex-col">
        {total === 0 ? (
          <div className="flex min-h-[160px] flex-1 items-center justify-center text-center text-sm text-text-muted">
            Check a few things off and your activity shows up here.
          </div>
        ) : (
          <GitGrid days={stats.contributions} />
        )}
      </div>

      {/* The three quiet analytics figures, centered in their own card. */}
      <div className="hidden flex-wrap items-center justify-center gap-x-10 gap-y-3 rounded-2xl border border-border bg-bg-elev px-5 py-4">
        <Figure
          color="#1f9d57"
          glyph={<CheckGlyph />}
          value={String(stats.doneThisWeek)}
          label="completed this week"
        />
        <Figure
          color="#3b82f6"
          glyph={<ClockGlyph />}
          value={fmtHours(stats.minutesThisWeek)}
          label="focused time"
        />
        <Figure
          color="#f59e0b"
          glyph={<FlameGlyph />}
          value={String(stats.activeDays30)}
          label="active days · 30d"
        />
      </div>
    </div>
  );
}

/* ── Git mode: GitHub-style contribution grid ─────────────────────── */

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const GAP = 3;

function GitGrid({ days }: { days: { date: string; count: number }[] }) {
  const peak = Math.max(1, ...days.map((d) => d.count));

  // Measure the available WIDTH. The square size is derived from it so the
  // columns tile the section edge-to-edge with a uniform gap and every cell
  // stays a perfect square. There is NO left gutter, so the grid is flush with
  // the section's left edge (aligned with the greeting + the stats card).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setW(r.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  type GridCell = { date: string; count: number } | null;

  // Front-pad so row 0 of the first column is a Sunday (GitHub layout).
  const first = new Date(days[0].date + "T00:00:00");
  const pad = first.getDay(); // 0=Sun
  const cells: GridCell[] = [
    ...Array.from<GridCell>({ length: pad }).fill(null),
    ...days.map((d) => ({ ...d })),
  ];
  const allWeeks: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7)
    allWeeks.push(cells.slice(i, i + 7));

  // Pick a column count that lands the square near a target size, capped by the
  // weeks we have, then solve CELL so the columns fill the width EXACTLY:
  //   cols*CELL + (cols-1)*GAP === w   → squares flush to both edges.
  const TARGET = 22;
  let cols = w > 0 ? Math.max(8, Math.round((w + GAP) / (TARGET + GAP))) : 18;
  cols = Math.min(cols, allWeeks.length);
  const CELL =
    w > 0 && cols > 0 ? Math.max(8, (w - (cols - 1) * GAP) / cols) : 14;

  // Most-recent `cols` weeks, ending at today on the right.
  const weeks = allWeeks.slice(Math.max(0, allWeeks.length - cols));

  // Month label per week column: the month name at the first column whose top
  // cell falls in a new month (mirrors GitHub).
  const monthLabels = weeks.map((week, wi) => {
    const firstReal = week.find(Boolean);
    if (!firstReal) return "";
    const m = new Date(firstReal.date + "T00:00:00").getMonth();
    const prev = weeks[wi - 1]?.find(Boolean);
    const prevM = prev ? new Date(prev.date + "T00:00:00").getMonth() : -1;
    return m !== prevM ? MONTH_NAMES[m] : "";
  });

  const shade = (count: number) => {
    if (count === 0) return "var(--surface)";
    const t = Math.min(1, count / peak);
    return `color-mix(in srgb, var(--accent) ${22 + t * 78}%, transparent)`;
  };

  return (
    <div ref={wrapRef} className="w-full">
      {/* Month labels — one per column, aligned to the squares below. */}
      <div className="flex" style={{ gap: GAP, marginBottom: GAP }}>
        {weeks.map((_, wi) => (
          <div
            key={wi}
            className="overflow-hidden text-[9px] leading-none text-text-dim"
            style={{ width: CELL }}
          >
            {monthLabels[wi]}
          </div>
        ))}
      </div>

      {/* Week columns — squares sized from the width, flush to both edges. */}
      <div className="flex" style={{ gap: GAP }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
            {Array.from({ length: 7 }).map((_, ri) => {
              const cell = week[ri];
              if (!cell)
                return (
                  <span
                    key={ri}
                    style={{ width: CELL, height: CELL }}
                    aria-hidden
                  />
                );
              const dayLabel = new Date(
                cell.date + "T00:00:00",
              ).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              });
              return (
                <div
                  key={ri}
                  className="group relative"
                  style={{ width: CELL, height: CELL }}
                >
                  <div className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-text px-2 py-1 text-[9.9px] font-medium text-bg opacity-0 shadow-lg transition group-hover:opacity-100">
                    {cell.count} {cell.count === 1 ? "task" : "tasks"} ·{" "}
                    {dayLabel}
                  </div>
                  <span
                    className="block h-full w-full rounded-[3px] transition group-hover:brightness-110"
                    style={{ backgroundColor: shade(cell.count) }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[9.5px] text-text-dim">
        Less
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span
            key={t}
            className="h-3 w-3 rounded-[3px]"
            style={{
              backgroundColor:
                t === 0
                  ? "var(--surface)"
                  : `color-mix(in srgb, var(--accent) ${22 + t * 78}%, transparent)`,
            }}
          />
        ))}
        More
      </div>
    </div>
  );
}

/** A compact inline figure for the analytics strip. */
function Figure({
  color,
  glyph,
  value,
  label,
}: {
  color: string;
  glyph: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{
          color,
          backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        }}
      >
        {glyph}
      </span>
      <span className="text-[13.5px] font-bold tabular-nums tracking-tight text-text">
        {value}
      </span>
      <span className="text-[10.8px] text-text-muted">{label}</span>
    </div>
  );
}

/* Shared "last edited" formatter for board meta. */
function lastEdited(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/* Shared right-click menu for a board (edit / trash). */
function useBoardMenu(
  board: Board,
  onEdit?: (b: Board) => void,
  onTrash?: (b: Board) => void,
) {
  return useMenu(() => [
    { label: "Edit board…", onClick: () => onEdit?.(board) },
    { type: "separator" as const },
    {
      label: "Move to trash",
      destructive: true,
      onClick: () => onTrash?.(board),
    },
  ]);
}

/* ── Board card (Quick access grid) ───────────────────────────────── */

function BoardCard({
  board,
  isActive,
  meta,
  onEdit,
  onTrash,
}: {
  board: Board;
  isActive: boolean;
  meta?: BoardMeta;
  onEdit?: (b: Board) => void;
  onTrash?: (b: Board) => void;
}) {
  const color = board.color ?? DEFAULT_BOARD_COLOR;
  const menu = useBoardMenu(board, onEdit, onTrash);
  const tasks = meta?.taskCount ?? 0;
  return (
    <Link
      href={`/app/${board.id}/gantt`}
      {...menu}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border bg-bg-elev transition hover:-translate-y-0.5 hover:border-border-strong",
        isActive ? "border-accent/60" : "border-border",
      )}
    >
      {/* Preview — solid board colour with a diagonal hatch (Gantt's flat
          visual language), dominated by a giant low-opacity white task-count
          (clipping is fine), with the icon medallion + Current badge on top. */}
      <div
        className="relative h-48 overflow-hidden border-b border-border"
        style={{ backgroundColor: color, backgroundImage: HATCH }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center font-bold leading-none tabular-nums text-white/25"
          style={{
            fontSize: "17rem",
            fontFamily: "var(--font-libre)",
            // Lining serif figures sit high in the line box; nudge to true centre.
            transform: "translateY(0.06em)",
          }}
        >
          {tasks}
        </span>
        {isActive ? (
          <span
            className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider shadow-sm"
            style={{ color }}
          >
            Current
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{
            color,
            backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
          }}
        >
          {board.icon ? (
            <BlockIcon name={board.icon} size={18} />
          ) : (
            <FolderGlyph />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.1px] font-semibold tracking-tight text-text">
            {board.name}
          </h3>
          <p className="mt-0.5 truncate text-[10.8px] text-text-dim">
            {tasks} {tasks === 1 ? "task" : "tasks"} · {lastEdited(meta?.updatedAt)}
          </p>
        </div>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-dim transition group-hover:bg-surface group-hover:text-text">
          <ChevronRight width={15} height={15} />
        </span>
      </div>
    </Link>
  );
}

/* ── Board list row (Recent) ──────────────────────────────────────── */

function BoardRow({
  board,
  isActive,
  meta,
  first,
  onEdit,
  onTrash,
}: {
  board: Board;
  isActive: boolean;
  meta?: BoardMeta;
  first: boolean;
  onEdit?: (b: Board) => void;
  onTrash?: (b: Board) => void;
}) {
  const color = board.color ?? DEFAULT_BOARD_COLOR;
  const menu = useBoardMenu(board, onEdit, onTrash);
  const tasks = meta?.taskCount ?? 0;
  return (
    <Link
      href={`/app/${board.id}/gantt`}
      {...menu}
      className={cn(
        "group flex items-center gap-3 bg-bg-elev px-4 py-3 transition hover:bg-surface",
        !first && "border-t border-border",
      )}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white"
        style={{ backgroundColor: color, backgroundImage: HATCH }}
      >
        {board.icon ? (
          <BlockIcon name={board.icon} size={16} />
        ) : (
          <FolderGlyph />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">
            {board.name}
          </span>
          {isActive ? (
            <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
              Current
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[10.8px] text-text-dim">
          {tasks} {tasks === 1 ? "task" : "tasks"}
        </p>
      </div>
      <span className="shrink-0 text-[10.8px] tabular-nums text-text-dim">
        {lastEdited(meta?.updatedAt)}
      </span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-dim transition group-hover:bg-surface group-hover:text-text">
        <ChevronRight width={15} height={15} />
      </span>
    </Link>
  );
}

/* ── Inline create row ────────────────────────────────────────────── */

const NewBoardInputRow = ({
  ref,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  ref: React.Ref<HTMLInputElement>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.14 }}
      className="overflow-hidden"
    >
      <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elev p-2">
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={DEFAULT_BOARD_NAME}
          maxLength={80}
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm placeholder:text-text-dim focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-md bg-surface px-3.5 py-1.5 text-[11.7px] font-semibold text-text-muted transition hover:bg-surface-hover hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          className="shrink-0 rounded-md bg-accent px-4 py-1.5 text-[11.7px] font-semibold text-white transition hover:brightness-110"
        >
          Create
        </button>
      </div>
    </motion.div>
  );
};

/* ── Trash view ───────────────────────────────────────────────────── */

function TrashView({
  trashed,
  onRestore,
  onDeleteForever,
}: {
  trashed: Board[];
  onRestore?: (board: Board) => void;
  onDeleteForever?: (board: Board) => void;
}) {
  if (trashed.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-text-dim">
          <Trash width={20} height={20} />
        </span>
        <h2 className="mt-4 text-base font-semibold text-text">Trash is empty</h2>
        <p className="mt-1 max-w-xs text-sm text-text-muted">
          Boards you move to the trash land here. Restore them any time, or
          delete them for good.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight text-text">Trash</h2>
        <p className="mt-1 text-sm text-text-muted">
          Restore a board to bring it back, or delete it forever — that also
          removes all its blocks, tasks, and steps.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        {trashed.map((board, i) => {
          const color = board.color ?? DEFAULT_BOARD_COLOR;
          return (
            <div
              key={board.id}
              className={cn(
                "flex items-center gap-3 bg-bg-elev px-4 py-3",
                i > 0 && "border-t border-border",
              )}
            >
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
                style={{ backgroundColor: color, backgroundImage: HATCH }}
              >
                {board.icon ? (
                  <BlockIcon name={board.icon} size={14} />
                ) : (
                  <FolderGlyph />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-text">
                {board.name}
              </span>
              <button
                onClick={() => onRestore?.(board)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-text-muted transition hover:bg-surface hover:text-text"
              >
                Restore
              </button>
              <button
                onClick={() => onDeleteForever?.(board)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-deadline transition hover:bg-deadline/10"
              >
                Delete forever
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}


/* ── Header controls ──────────────────────────────────────────────── */

/**
 * The header theme toggle.
 *
 * ⚠️ **`user_settings.theme` is the state; `gantt:theme` in `localStorage` is
 * only the cache the pre-paint bootstrap in `app/layout.tsx` reads.** This
 * toggle used to know about the cache alone: it seeded from
 * `document.dataset.theme` (i.e. from `localStorage`) and wrote nowhere else.
 * Two things followed, both MEASURED. A window whose `localStorage` was empty —
 * a fresh profile, or any launch on a port the OS handed out afresh, since the
 * origin keys the store — opened the picker DARK with `theme: "light"` on disk,
 * and stayed wrong for the whole visit. And a toggle made here was reverted the
 * moment a board opened, because the board seeds from the row and the row had
 * never been told.
 *
 * So: seed from the row (`initial`, handed down from the page's own
 * `readSettings()`), write the row on every toggle, and keep mirroring to
 * `localStorage` so the next first paint is already right. Worst case on a cold
 * cache is one frame of the default theme before this effect runs — the same
 * cost the board pays, and the reason the mirror exists at all.
 *
 * ⚠️ A DELTA, never the whole document: `updateSettings` merges, and a caller
 * that posted its own hydrated snapshot would revert every field changed
 * elsewhere since this page loaded. One key is the patch.
 */
function ThemeToggle({ initial }: { initial: "dark" | "light" }) {
  const [theme, setTheme] = useState<"dark" | "light">(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = initial;
    try {
      localStorage.setItem("gantt:theme", initial);
    } catch {}
  }, [initial]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("gantt:theme", next);
    } catch {}
    void updateSettings({ theme: next }).catch((e) =>
      console.error("[board-home] theme save failed", e),
    );
  };
  return (
    <button
      onClick={toggle}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition hover:bg-surface hover:text-text"
    >
      {theme === "dark" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/* Stat glyphs for the week summary. */
function CheckGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function ClockGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function FlameGlyph() {
  // Use Lucide's vetted Flame glyph directly — every hand-authored attempt
  // smudged at 18px. inherits color via currentColor.
  return <Flame size={17} strokeWidth={2} aria-hidden />;
}
