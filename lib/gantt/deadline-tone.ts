/**
 * Urgency palette shared by every deadline surface — the timeline deadline
 * blocks (step-row), the header markers, and the chip rail. Red when overdue,
 * accent on the due day, amber within two days, calm neutral otherwise.
 *
 * Red stays reserved for genuine urgency: a deadline that's still comfortably
 * ahead reads as neutral, never alarm-red. `dDays` is signed days-to-due
 * (negative = overdue, 0 = today).
 */
export type DeadlineTone = {
  bg: string;
  border: string;
  text: string;
  countBg: string;
  countText: string;
};

export function deadlineTone(dDays: number): DeadlineTone {
  const overdue = dDays < 0;
  const isToday = dDays === 0;
  const urgent = !overdue && !isToday && dDays <= 2;
  if (overdue)
    return {
      bg: "rgba(239, 68, 68, 0.10)",
      border: "rgba(239, 68, 68, 0.35)",
      text: "var(--text)",
      countBg: "rgba(239, 68, 68, 0.18)",
      countText: "#fca5a5",
    };
  if (isToday)
    return {
      bg: "rgba(59, 130, 246, 0.12)",
      border: "rgba(59, 130, 246, 0.4)",
      text: "var(--text)",
      countBg: "rgba(59, 130, 246, 0.22)",
      countText: "var(--accent)",
    };
  if (urgent)
    return {
      bg: "rgba(245, 158, 11, 0.10)",
      border: "rgba(245, 158, 11, 0.35)",
      text: "var(--text)",
      countBg: "rgba(245, 158, 11, 0.20)",
      countText: "#fbbf24",
    };
  return {
    bg: "var(--surface)",
    border: "var(--border)",
    text: "var(--text)",
    countBg: "var(--bg-elev)",
    countText: "var(--text-muted)",
  };
}
