"use client";

import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/gantt/constants";

/**
 * Phone-only view switcher. A glassmorphism pill (Day / Week, with
 * icons) plus a matching circular button for the theme toggle, all
 * centered at the bottom of the viewport.
 *
 *   [ ▦ Day | ▤ Week ]   ( ☀/☾ )
 */
export function MobileBottomNav({
  view,
  onSetView,
  theme,
  onToggleTheme,
}: {
  view: ViewMode;
  onSetView: (v: ViewMode) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const dayActive = view === "gantt" || view === "day";
  const weekActive = view === "week";
  return (
    <div
      className="pointer-events-none fixed left-1/2 z-50 flex -translate-x-1/2 gap-2"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <nav
        aria-label="Primary"
        className="pointer-events-auto flex h-12 items-center gap-1 rounded-full border border-white/15 bg-white/10 p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      >
        <PillButton
          label="Day"
          active={dayActive}
          onClick={() => onSetView("gantt")}
          icon={<DayIcon />}
        />
        <PillButton
          label="Week"
          active={weekActive}
          onClick={() => onSetView("week")}
          icon={<WeekIcon />}
        />
      </nav>
      <button
        onClick={onToggleTheme}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/10 text-text shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)] backdrop-blur-xl active:scale-95"
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
    </div>
  );
}

function PillButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-full px-4 text-[11.7px] font-medium transition",
        active
          ? "bg-white/90 text-black shadow-sm"
          : "text-text active:bg-white/10",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function DayIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 10h16" />
      <path d="M9 15h6" />
    </svg>
  );
}

function WeekIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 5v16M16 5v16" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
