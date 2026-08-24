"use client";

import { useMemo, useState } from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

/**
 * Notion-style icon picker. Browses Lucide's full set with a search
 * input. We seed the grid with a curated common-use selection so the
 * default view isn't 1500 icons of noise.
 *
 * `value` is the currently-selected icon name (or null for "no icon").
 * `onSubmit` receives the chosen name, or null when the user clears it.
 *
 * Validation note: schemas.ts pins icon names to `[A-Za-z0-9]+`, which
 * matches Lucide's naming convention. We round-trip names without ever
 * deserialising into a React component on the server.
 */

const FEATURED: readonly string[] = [
  "Briefcase",
  "Book",
  "BookOpen",
  "GraduationCap",
  "Brain",
  "Code",
  "Terminal",
  "Cpu",
  "Database",
  "Rocket",
  "Target",
  "Trophy",
  "Flame",
  "Zap",
  "Star",
  "Calendar",
  "Clock",
  "Timer",
  "AlarmClock",
  "CalendarDays",
  "FileText",
  "Folder",
  "FolderOpen",
  "Files",
  "Notebook",
  "PenTool",
  "Pencil",
  "Palette",
  "Image",
  "Camera",
  "Music",
  "Headphones",
  "Mic",
  "Video",
  "Film",
  "Globe",
  "Map",
  "MapPin",
  "Compass",
  "Plane",
  "Heart",
  "Smile",
  "Coffee",
  "Pizza",
  "Cake",
  "Home",
  "Building",
  "ShoppingBag",
  "Gift",
  "Package",
  "Users",
  "User",
  "MessageCircle",
  "Mail",
  "Phone",
  "DollarSign",
  "TrendingUp",
  "BarChart",
  "PieChart",
  "LineChart",
  "Lightbulb",
  "Sparkles",
  "Wand",
  "Beaker",
  "FlaskConical",
  "Dumbbell",
  "Bike",
  "Footprints",
  "Mountain",
  "Trees",
];

// The lucide-react namespace mixes icon components with helpers
// (`createLucideIcon`, the `icons` map, type re-exports). Flatten it into a
// plain string-keyed record so we can do dynamic `[name]` lookups; each value
// is narrowed to a `LucideIcon` at the point it's rendered.
const IconRegistry: Record<string, unknown> = { ...LucideIcons };

function isIconName(name: string): boolean {
  // Lucide also exports things like `createLucideIcon`, `Icon`. Filter
  // those out — real icon components are PascalCase and render an svg.
  if (!/^[A-Z][A-Za-z0-9]+$/.test(name)) return false;
  if (name === "Icon" || name === "LucideIcon" || name.endsWith("Icon"))
    return false;
  return (
    typeof IconRegistry[name] === "object" ||
    typeof IconRegistry[name] === "function"
  );
}

/**
 * Reusable search + icon grid (no modal chrome). Shared by the standalone
 * `BlockIconPicker` and the inline icon section in `BlockModal`, so both stay
 * visually identical. `onPick` fires with the chosen name; pass `onRemove` to
 * show a "Remove icon" affordance.
 */
export function BlockIconGrid({
  value,
  onPick,
  onRemove,
}: {
  value: string | null;
  onPick: (name: string) => void;
  onRemove?: () => void;
}) {
  const [query, setQuery] = useState("");

  const allNames = useMemo(
    () => Object.keys(IconRegistry).filter(isIconName).sort(),
    [],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FEATURED.filter((n) => isIconName(n));
    return allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 144);
  }, [query, allNames]);

  return (
    <div>
      <div className="flex items-center gap-2 px-1 pb-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 1500+ icons…"
          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[11.7px] placeholder:text-text-dim focus:border-accent focus:outline-none"
        />
        {onRemove && value && (
          <button
            onClick={onRemove}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[9.9px] text-text-muted transition hover:bg-surface hover:text-deadline"
          >
            Remove
          </button>
        )}
      </div>
      <div className="max-h-[240px] overflow-y-auto px-1">
        <div className="grid grid-cols-8 gap-1">
          {visible.map((name) => {
            const Icon = IconRegistry[name] as LucideIcon;
            return (
              <button
                key={name}
                onClick={() => onPick(name)}
                title={name}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface hover:text-text",
                  value === name && "bg-accent/15 text-accent",
                )}
              >
                <Icon size={16} strokeWidth={1.75} />
              </button>
            );
          })}
        </div>
        {visible.length === 0 && (
          <div className="px-2 py-6 text-center text-[10.8px] italic text-text-dim">
            Nothing matches “{query}”.
          </div>
        )}
      </div>
    </div>
  );
}

export function BlockIconPicker({
  open,
  value,
  onClose,
  onSubmit,
}: {
  open: boolean;
  value: string | null;
  onClose: () => void;
  onSubmit: (icon: string | null) => void;
}) {
  function pick(name: string | null) {
    onSubmit(name);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md">
      <ModalHeader title="Choose an icon" />
      <div className="px-5 pb-5 pt-2">
        <BlockIconGrid
          value={value}
          onPick={(name) => pick(name)}
          onRemove={() => pick(null)}
        />
      </div>
    </Modal>
  );
}

/**
 * Render the chosen icon (or null). Server-rendered output is plain SVG
 * — no client JS needed to display, so block headers stay light.
 */
export function BlockIcon({
  name,
  size = 12,
  color,
  className,
}: {
  name: string | null | undefined;
  size?: number;
  color?: string;
  className?: string;
}) {
  if (!name) return null;
  const Icon = IconRegistry[name] as LucideIcon | undefined;
  if (!Icon) return null;
  return (
    <Icon
      size={size}
      strokeWidth={1.85}
      className={className}
      style={color ? { color } : undefined}
    />
  );
}
