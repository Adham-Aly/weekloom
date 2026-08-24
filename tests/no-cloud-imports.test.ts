import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * WEEKLOOM IS A LOCAL APPLICATION. THIS FILE IS WHAT KEEPS THAT TRUE.
 *
 * There are no accounts, no server it talks to, no payment processor and no
 * third-party API. Every board, task and setting lives in one SQLite file in
 * the user's own home directory, and the only socket the product opens is the
 * loopback one the desktop shell spawns for itself. That is the product, not a
 * configuration of it — so "nobody has added a cloud dependency yet" is not
 * good enough. This is the assertion that it stays that way.
 *
 * ## Why a source scan and not a type error
 *
 * `components/**` is outside vitest's include (`vitest.config.ts`), so the
 * ~6,300-line board is invisible to `npm test`. A cloud SDK re-entering there
 * would typecheck, build, and ship. Reading the files as TEXT is the only
 * automated defence that reaches them. `electron/**` is in the same position
 * for a different reason — it compiles under its own tsconfig and can only be
 * loaded by Electron.
 *
 * ## ⚠️ The scan excludes `*.test.ts`, INCLUDING ITSELF, and that is
 * load-bearing rather than an oversight
 *
 * This file must contain `"@supabase/ssr"`, `"stripe"`, `"PAYWALL_ENABLED"`,
 * `"demoMode"` and the rest as literal source text — those lists ARE the guard.
 * A scan that included test files would flag its own vocabulary, and the
 * tempting "fix" is to shrink the lists, which deletes the only durable
 * expression of what this project is. If you are here because the test flagged
 * itself, the bug is in the exclusion, not in the lists.
 *
 * ## Mutation test
 *
 * EXECUTED and verified, each against the real tree:
 *
 *  * A new file under `lib/` containing
 *    `import { createClient } from "@supabase/ssr";` → test 1 RED. ⚠️ The file
 *    was never `git add`ed, which is the proof that `--others` matters: a guard
 *    reading only tracked files is asleep for exactly the window in which a
 *    regression is written.
 *  * The same file containing `entitlement` / `isPro` → test 2 RED.
 *  * The same file importing `node:sqlite` → test 4 RED.
 *  * The same file containing a `supabase.co` URL → test 3 RED.
 *  * `hasIdentifier` made to always return `false` → test 7 RED, i.e. the
 *    control fails BEFORE tests 1-2 can pass vacuously.
 *  * The `\b` boundaries removed from `hasIdentifier` → test 8 RED, because
 *    `blockKey` starts matching `lockKey`.
 *
 * Not executed, because it would mean editing the manifest: adding `"zustand"`
 * to `package.json`'s `dependencies` reds test 5 — even though nobody wrote the
 * word `zustand` here — because that test compares the whole list, not a
 * blocklist. Adding an external origin to `next.config.ts`'s CSP reds test 3;
 * test 9 pins the comment stripper it relies on in both directions.
 */

const REPO_ROOT = join(__dirname, "..");

// ─── What may never come back ───────────────────────────────────────────

/**
 * Module specifiers. Matched EXACTLY or as a subpath prefix, never as a
 * substring: a substring match on `pg` would flag `pgsql-parser`, and a project
 * that cries wolf gets its guard deleted.
 */
const FORBIDDEN_SPECIFIERS = [
  "@supabase/ssr",
  "@supabase/supabase-js",
  "stripe",
  "@stripe/stripe-js",
  "@stripe/react-stripe-js",
  "googleapis",
  "google-auth-library",
  "@modelcontextprotocol/server",
  "pg",
  "remotion",
  "uuid",
  "@/lib/supabase",
  "@/lib/billing",
  "@/lib/stripe",
  "@/lib/gcal",
  "@/lib/mcp",
  "@/lib/auth",
  "@/lib/sync",
  "@/lib/env",
  "@/lib/blog",
  "@/lib/demo",
  "@/lib/actions/pro-gate",
  "@/lib/actions/stale-write",
  "@/lib/hooks/use-paywall",
  "@/lib/hooks/use-board-realtime",
  "@/lib/hooks/use-board-collab",
  "@/app/gcal-actions",
  "@/app/billing-actions",
  "@/app/share-actions",
  "@/app/auth-actions",
];

/**
 * Identifiers. These are the vocabulary of accounts, tiers and a network — the
 * three ideas this product does not have.
 *
 * ⚠️ `readOnly` is deliberately NOT here. `components/ui/event-edit-popover.tsx`
 * uses it as a real DOM attribute on an `<input>`, which is nothing to do with
 * a viewer role. It gets a targeted per-file assertion instead (test 6), so the
 * places where it WOULD mean a permission are still covered.
 */
const FORBIDDEN_IDENTIFIERS = [
  "PAYWALL_ENABLED",
  "CAPABILITIES",
  "resolveEntitlement",
  "freeEntitlement",
  "hasPaidPlan",
  "Entitlement",
  "entitlement",
  "isPro",
  "usePaywall",
  // ⚠️ Both spellings, and the reason is measured: `hasIdentifier` is
  // `\bneedle\b`, so `usePaywall` does NOT fire on the word `paywalled`.
  // Five paywall/tier comments survived a full implementation phase in
  // `board.tsx` for exactly that reason — the guard was asked the wrong
  // question. The scan reads RAW source, not stripped source, so prose is
  // in scope and these two close the word family.
  "paywall",
  "paywalled",
  "NeedsPro",
  "isNeedsPro",
  "asNeedsPro",
  "NEEDS_PRO_CODE",
  "demoMode",
  "createAdminClient",
  "runAsBearer",
  "assertBearerLane",
  "requireUser",
  "kickOutboundDrain",
  "CALENDAR_BLOCK_NAME",
  "effectivePersonalization",
  "NEVER_PERSISTED",
  "beginLocalWrite",
  "isStaleWrite",
  "expectedUpdatedAt",
  "boardRole",
  "boardShared",
  "currentUserId",
  "escapeIlike",
  "logEvent",
  "revalidatePath",
];

/**
 * Hostnames. Matched as substrings on purpose — these appear inside URL string
 * literals, not as identifiers, and there is no benign spelling of any of them.
 */
const FORBIDDEN_HOSTS = [
  "supabase.co",
  "js.stripe.com",
  "api.stripe.com",
  "googleapis.com",
  "gstatic.com",
  "accounts.google.com",
  "r2.dev",
  "weekloom.com",
];

/**
 * The complete runtime dependency list, enumerated rather than blocklisted.
 *
 * This is the strongest test in the file: a blocklist only catches names
 * somebody thought of, while an allowlist catches a cloud SDK nobody has heard
 * of yet. Adding a runtime dependency is a deliberate act, so making it a
 * deliberate act *here too* costs one line and buys the property outright.
 */
const ALLOWED_DEPS = [
  "clsx",
  "cuelume",
  "date-fns",
  "framer-motion",
  "lucide-react",
  "next",
  "react",
  "react-dom",
  "server-only",
  "tailwind-merge",
  "zod",
];

// ─── Mechanics ──────────────────────────────────────────────────────────

/**
 * Every shipping source file, from git rather than from a directory walk.
 *
 * ⚠️ `--others` includes UNTRACKED files. The window in which a regression is
 * authored is the window before it is staged, and a guard that only reads
 * committed files is asleep for exactly that window. `--exclude-standard`
 * keeps `node_modules`, `.next` and the rest of `.gitignore` out.
 */
function shippingSource(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "."],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return (
    out
      .split("\n")
      .filter((f) => f !== "")
      .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
      // See the docstring: the exclusion of test files is the guard, not a hole.
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => !f.startsWith("e2e/"))
      // `--cached` still lists files a change has deleted from the working tree.
      .filter((f) => existsSync(join(REPO_ROOT, f)))
  );
}

const SOURCE = shippingSource();
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ⚠️ Identifier-boundary matching, never `String.includes`.
 *
 * MEASURED, and the reason this function exists: `"blockKey".includes("lockKey")`
 * is `true`. `lib/demo/demo-data.ts` once made exactly that false positive real.
 */
export function hasIdentifier(source: string, needle: string): boolean {
  return new RegExp(`\\b${escapeRe(needle)}\\b`).test(source);
}

/**
 * Module specifiers extracted STRUCTURALLY, so a banned bare name can never
 * match a longer package that merely starts with it.
 *
 * ⚠️ This is why `pg` can be on the list at all: as a substring it would hit
 * `pgsql-parser`, `pg-promise` and the word "pg" inside a comment.
 */
export function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g,
  )) {
    out.push(m[1]);
  }
  return out;
}

export function isBannedSpecifier(spec: string): boolean {
  return FORBIDDEN_SPECIFIERS.some(
    (b) => spec === b || spec.startsWith(`${b}/`),
  );
}

/**
 * Strip comments before scanning `next.config.ts` for an external origin.
 *
 * The config's own prose explains WHY it names no external origin, and saying
 * so requires writing the scheme down. A raw scan would flag the explanation,
 * and the tempting fix is to delete the explanation. Test 9 proves the stripper
 * works before test 3 is believed. It leaves string literals alone, so the
 * thing being hunted — an origin inside a CSP string — is still visible.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote !== null) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// ─── The claims ─────────────────────────────────────────────────────────

describe("Weekloom stays a local application", () => {
  it("1. no shipping source file imports a cloud, payment or vendor module", () => {
    const offenders = SOURCE.map((f) => ({
      file: f,
      hits: importSpecifiers(read(f)).filter(isBannedSpecifier),
    })).filter((r) => r.hits.length > 0);

    expect(offenders).toEqual([]);
  });

  it("2. no shipping source file names an account, tier or sync identifier", () => {
    const offenders = SOURCE.map((f) => {
      const src = read(f);
      return {
        file: f,
        hits: FORBIDDEN_IDENTIFIERS.filter((n) => hasIdentifier(src, n)),
      };
    }).filter((r) => r.hits.length > 0);

    expect(offenders).toEqual([]);
  });

  it("3. no third-party hostname appears in source or in the CSP", () => {
    const offenders = SOURCE.map((f) => {
      const src = read(f);
      return { file: f, hits: FORBIDDEN_HOSTS.filter((h) => src.includes(h)) };
    }).filter((r) => r.hits.length > 0);

    expect(offenders).toEqual([]);

    // ⚠️ The CSP is the runtime half of the same claim: `connect-src 'self'` is
    // what stops an accidental fetch succeeding. Any external origin here is a
    // hole in it.
    expect(stripComments(read("next.config.ts"))).not.toMatch(/https?:\/\/\w/);
  });

  it("4. only lib/db opens a database handle", () => {
    const users = SOURCE.filter((f) =>
      importSpecifiers(read(f)).includes("node:sqlite"),
    );
    // Positive control: if nothing imports it the assertion below is vacuous.
    expect(users.length).toBeGreaterThan(0);
    expect(users.filter((f) => !f.startsWith("lib/db/"))).toEqual([]);
  });

  it("5. the runtime dependency list is exactly this and nothing else", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    // Enumeration, not a blocklist: a NEW cloud dependency fails here even
    // though nobody thought of its name when this list was written.
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(ALLOWED_DEPS);
  });

  it("6. no surviving file carries a viewer-permission flag", () => {
    // ⚠️ Scoped rather than global: `readOnly` is a real DOM attribute
    // elsewhere. These four are the files where it meant "this account may not
    // edit this board", which is the idea being removed.
    for (const file of [
      "lib/hooks/board-edit-context.ts",
      "components/gantt/board.tsx",
      "components/gantt/step-row.tsx",
      "components/gantt/calendar.tsx",
    ]) {
      expect(existsSync(join(REPO_ROOT, file))).toBe(true);
      expect(hasIdentifier(read(file), "readOnly")).toBe(false);
    }
  });

  it("7. the detectors fire — positive control", () => {
    // ⚠️ Prove the matchers work before believing any empty result above.
    expect(
      importSpecifiers(`import { createClient } from "@supabase/ssr";`).filter(
        isBannedSpecifier,
      ),
    ).toEqual(["@supabase/ssr"]);
    expect(
      importSpecifiers(`const s = require("stripe");`).filter(
        isBannedSpecifier,
      ),
    ).toEqual(["stripe"]);
    expect(isBannedSpecifier("@/lib/gcal/drain")).toBe(true);
    expect(hasIdentifier(`const x = PAYWALL_ENABLED;`, "PAYWALL_ENABLED")).toBe(
      true,
    );
    // …and on a token that really is in the tree right now, so the identifier
    // matcher is proven against real source rather than a fixture.
    const board = "components/gantt/board.tsx";
    expect(SOURCE).toContain(board);
    expect(hasIdentifier(read(board), "GanttBoard")).toBe(true);
  });

  it("8. the detectors do not over-fire — negative control", () => {
    // MEASURED: a substring match would call both of these a hit.
    expect(hasIdentifier("const readOnlyFoo = 1;", "readOnly")).toBe(false);
    expect(hasIdentifier("const blockKey = 1;", "lockKey")).toBe(false);
    // Structural specifier extraction, so a longer package name is safe.
    expect(isBannedSpecifier("pgsql-parser")).toBe(false);
    expect(isBannedSpecifier("@/lib/db")).toBe(false);
    expect(isBannedSpecifier("@/lib/environment")).toBe(false);
    // The hostname matcher must not flag the one host this app DOES use.
    expect(
      FORBIDDEN_HOSTS.some((h) => "http://127.0.0.1:3999".includes(h)),
    ).toBe(false);
  });

  it("9. the scan reached the real tree — coverage assertion", () => {
    // ⚠️ Set membership, not a count. An empty or truncated scan passes every
    // absence check above, and three wrong files cancel out in a total.
    expect(SOURCE.length).toBeGreaterThan(100);
    for (const named of [
      "components/gantt/board.tsx",
      "app/actions.ts",
      "lib/db/connection.ts",
      "electron/main.ts",
      "next.config.ts",
    ]) {
      expect(SOURCE).toContain(named);
    }
    // And the comment stripper test 3 leans on works in both directions.
    expect(
      stripComments(`// see https://example.com\nconst a = 1;`),
    ).not.toMatch(/https?:\/\/\w/);
    expect(stripComments(`const u = "https://example.com"; // note`)).toMatch(
      /https?:\/\/\w/,
    );
  });
});
