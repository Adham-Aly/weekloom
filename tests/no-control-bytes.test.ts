import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * No source file may contain a raw control byte.
 *
 * ## Why this exists
 *
 * A regex character class whose bounds are RAW control bytes rather than
 * `\u0000` / `\u001F` escape sequences behaves correctly and is invisible to
 * tooling. `file` reports the module as `data`, and **`grep`
 * silently skips binary files**. That happened here, to an
 * input-validation guard: the check was present and working, and a reviewer
 * searching for it found nothing and correctly concluded, from the evidence
 * available, that it was missing.
 *
 * That is a distinct failure class from a bug. The control *behaves*; it just
 * cannot be *audited*. Every future `grep`, every CI text scan, and every
 * reviewer who checks the cheap way first gets a false negative — on security
 * code, which is exactly where the cheap check gets used most.
 *
 * Secondary costs: editors, formatters and copy-paste all mangle raw control
 * bytes, so a rule written this way can be silently corrupted by a routine
 * reformat, and `git diff` renders the file as "Binary files differ".
 *
 * ## Why a test rather than a habit
 *
 * Two people independently wrote a shell check for this and **both checks
 * silently did nothing**. One used `grep -P`, which BSD grep on macOS does not
 * support, so every invocation errored, the `&&` never fired, and the loop
 * printed nothing — indistinguishable from a clean result. The other only ever
 * grepped for specific identifiers.
 *
 * A check that silently never runs looks exactly like a check that passes. That
 * is the same failure the literal control bytes caused in the first place, one
 * level up — which is why this is a test, and why the test proves it actually
 * ran (see the two guards below) rather than asserting an empty list and
 * calling it clean.
 *
 * ## Mutation test
 *
 * Put a literal NUL byte back into any source file and
 * `"no source file contains a raw control byte"` goes red. Verified.
 */

/**
 * Control bytes that are never legitimate in source.
 *
 * TAB (0x09), LF (0x0A) and CR (0x0D) are deliberately EXCLUDED — they are
 * ordinary whitespace and every file has them. Everything else in C0, plus DEL.
 */
function isForbiddenByte(b: number): boolean {
  if (b === 0x09 || b === 0x0a || b === 0x0d) return false;
  return b < 0x20 || b === 0x7f;
}

const ROOTS = ["lib", "app", "tests", "components", "electron", "e2e"];

/**
 * Root-level config files, which no directory walk above would reach.
 *
 * These are where the config-shaped SECURITY decisions live, so they are the
 * files where an invisible control byte would do the most damage:
 *
 *   * `next.config.ts` — the CSP, whose `connect-src 'self'` is the runtime
 *     half of "your data never leaves your computer". A literal control byte
 *     inside a header value is the exact scenario this test exists for: the
 *     policy behaves one way while every `grep` for it comes back empty.
 *   * `eslint.config.mjs` — the import restriction that keeps the SQLite
 *     handle inside `lib/db/`, because the connection pragmas are per
 *     connection and a second handle silently disables every cascade.
 *   * `electron-builder.yml` — the `extraResources` mapping that puts the Next
 *     server outside the asar. One wrong character there is an app that starts
 *     to a dialog, or does not start at all.
 *   * `playwright.config.ts` — the throwaway `WEEKLOOM_DATA_DIR` that keeps
 *     the end-to-end suite off the user's real database.
 */
const ROOT_FILES = [
  "next.config.ts",
  "eslint.config.mjs",
  "electron-builder.yml",
  "playwright.config.ts",
  "vitest.config.ts",
  "instrumentation.ts",
  "package.json",
  "tsconfig.json",
  "tsconfig.electron.json",
];
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".json", ".yml"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
]);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // root not present in this checkout
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (EXTENSIONS.some((e) => full.endsWith(e))) out.push(full);
    }
  };
  for (const root of ROOTS) walk(root);
  for (const file of ROOT_FILES) {
    try {
      statSync(file);
      out.push(file);
    } catch {
      // Not present in this checkout; the coverage assertion below catches a
      // wholesale disappearance.
    }
  }
  return out;
}

function offendingBytes(file: string): string[] {
  const buf = readFileSync(file);
  const found = new Set<number>();
  for (const b of buf) if (isForbiddenByte(b)) found.add(b);
  return [...found].sort((a, b) => a - b).map((b) => `0x${b.toString(16)}`);
}

describe("source files contain no raw control bytes", () => {
  it("the detector actually detects — positive control", () => {
    // Pin the detector BEFORE anything relies on it. A scanner whose predicate
    // is broken reports every file clean and passes forever. This is the guard
    // both hand-rolled sweeps lacked.
    expect(isForbiddenByte(0x00)).toBe(true); // NUL
    expect(isForbiddenByte(0x1f)).toBe(true); // US
    expect(isForbiddenByte(0x1b)).toBe(true); // ESC
    expect(isForbiddenByte(0x7f)).toBe(true); // DEL
    // ...and does not flag ordinary whitespace, or this test would fail on
    // every file in the repo and get deleted rather than fixed.
    expect(isForbiddenByte(0x09)).toBe(false); // TAB
    expect(isForbiddenByte(0x0a)).toBe(false); // LF
    expect(isForbiddenByte(0x0d)).toBe(false); // CR
    expect(isForbiddenByte(0x20)).toBe(false); // space
    expect(isForbiddenByte(0x41)).toBe(false); // 'A'
  });

  it("the sweep actually scans files — it is not silently a no-op", () => {
    // The other half. An empty file list produces an empty offender list, which
    // is indistinguishable from success. This repo has hundreds of source
    // files; a count near zero means the walker broke, not that the repo shrank.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    // And it reaches the directories that matter most. ⚠️ Set membership, not
    // a count: three wrong entries cancel out in a total.
    expect(files.some((f) => f.includes("lib/db"))).toBe(true);
    expect(files.some((f) => f.includes("electron/"))).toBe(true);
    // The root config files specifically — a walk over ROOTS alone would miss
    // every one of them, and they are the highest-value targets in the repo.
    expect(files).toContain("next.config.ts");
    expect(files).toContain("eslint.config.mjs");
    expect(files).toContain("electron-builder.yml");
  });

  it("no source file contains a raw control byte", () => {
    const offenders = sourceFiles()
      .map((file) => ({ file, bytes: offendingBytes(file) }))
      .filter((r) => r.bytes.length > 0)
      .map((r) => `${r.file} (${r.bytes.join(", ")})`);

    // Named in the failure message rather than just counted, so the fix is
    // obvious from CI output alone: replace the raw byte with an escape
    // sequence (a backslash-u or backslash-x form).
    expect(offenders).toEqual([]);
  });
});
