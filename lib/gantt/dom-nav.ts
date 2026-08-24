/**
 * Cross-row keyboard navigation between the label and effort inputs on
 * StepRow. Uses DOM data attributes so any future row layout that exposes
 * `[data-nav-col][data-nav-row]` plugs in automatically.
 *
 * TODO(sprint-3): replace with a context-backed registry so we don't
 * `querySelectorAll` on every keypress.
 */
export function navigateInputs(
  col: "label" | "effort",
  currentStepId: string,
  delta: number,
) {
  const all = Array.from(
    document.querySelectorAll<HTMLInputElement>(`[data-nav-col="${col}"]`),
  );
  const i = all.findIndex((el) => el.dataset.navRow === currentStepId);
  const next = all[i + delta];
  if (!next) return;
  requestAnimationFrame(() => {
    next.focus();
    next.select();
  });
}

export function focusSiblingCol(
  currentStepId: string,
  col: "label" | "effort",
) {
  const el = document.querySelector<HTMLInputElement>(
    `[data-nav-col="${col}"][data-nav-row="${currentStepId}"]`,
  );
  if (!el) return;
  requestAnimationFrame(() => {
    el.focus();
    el.select();
  });
}
