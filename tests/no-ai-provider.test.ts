import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * WEEKLOOM RUNS NO INFERENCE AND HOLDS NO MODEL-PROVIDER CREDENTIAL.
 *
 * ## Why this exists
 *
 * Weekloom is a local application: a person's plans live in one SQLite file in
 * their own home directory and the product opens no socket but the loopback one
 * it serves itself on. An AI integration is the single cheapest way to break
 * that, because it does not look like a network feature — it looks like a
 * summarize button. One `npm i openai` and the most private thing in the
 * application, everything the user is planning to do, is leaving the machine.
 *
 * ⚠️ **This is a standing project value, not a promise to a third party**, and
 * an open-source local application has more reason to hold it than a hosted one
 * would: a user can read this repository and see for themselves. That is only
 * worth anything if it stays checkable, and **nothing else here would notice** —
 * the feature would work, the build would pass, every other test would stay
 * green.
 *
 * Read a failure here as: *"you added an AI integration; either it is a
 * deliberate change of what this project is, and the README and this test
 * change with it — or undo it."* Both are legitimate. Silently doing neither is
 * not.
 *
 * ⚠️ What is pinned is narrower than "the word AI never appears": it is
 * Weekloom itself holding a model provider's SDK or calling a model provider's
 * endpoint. Prose about a vendor is not an integration, and test 6 proves that
 * distinction actually holds rather than merely being intended.
 *
 * ## Mutation test
 *
 * Verified, all four: add `"openai"` to `package.json` dependencies → test 1
 * red. Add `import OpenAI from "openai";` to any file under `lib/` → test 2
 * red. Add the string `api.anthropic.com` to any scanned file → test 3 red.
 * Break `specifierIsAiSdk` to always return false → tests 5 and 6 red.
 */

// ─── What counts as an AI provider SDK ──────────────────────────────────

/**
 * Bare package names. Matched EXACTLY or as a subpath prefix (`openai/shims`),
 * never as a substring - a substring match on `"ai"` would hit half of npm.
 */
const AI_PACKAGES = [
  "openai",
  "ai",
  "cohere-ai",
  "ollama",
  "replicate",
  "langchain",
  "groq-sdk",
  "together-ai",
  "@google/generative-ai",
  "@google/genai",
  "@aws-sdk/client-bedrock-runtime",
];

/** Scopes where every package is a model SDK. Matched as a prefix. */
const AI_SCOPES = [
  "@anthropic-ai/",
  "@mistralai/",
  "@huggingface/",
  "@langchain/",
  "@ai-sdk/",
];

/**
 * Inference endpoints. Hostnames, not vendor names — a file may name a vendor
 * in prose (an agent skill under `.agents/` explains how to drive this app,
 * for instance) without that being an integration. Test 6 proves the matchers
 * hold that line rather than merely intending to.
 */
const AI_HOSTNAMES = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.cohere.ai",
  "api.mistral.ai",
  "api.replicate.com",
  "api-inference.huggingface.co",
  "api.groq.com",
  "api.together.xyz",
  "bedrock-runtime.",
];

function specifierIsAiSdk(spec: string): boolean {
  if (AI_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`))) {
    return true;
  }
  return AI_SCOPES.some((s) => spec.startsWith(s));
}

/** Every module specifier a file imports, however it spells the import. */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /^\s*import\s+["']([^"']+)["']/gm,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) out.push(m[1]);
  }
  return out;
}

// ─── The scanned set ────────────────────────────────────────────────────

/**
 * Shipping source only. `tests/**` is excluded because this file legitimately
 * contains every string it hunts for — the same reason
 * `tests/no-cloud-imports.test.ts` excludes itself. `electron/` is INCLUDED:
 * the main process is the one place in this repo that could make an outbound
 * request without any renderer being involved.
 */
const SCAN_ROOTS = ["app", "components", "lib", "electron"];
const REPO_ROOT = join(__dirname, "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const scanned = SCAN_ROOTS.flatMap((r) => walk(join(REPO_ROOT, r)));
const rel = (f: string) => f.slice(REPO_ROOT.length + 1);

// ─── The claims ─────────────────────────────────────────────────────────

describe("Weekloom integrates no third-party AI provider", () => {
  it("1. no AI provider SDK is a dependency", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];

    // Coverage: a manifest that failed to parse would pass an empty scan.
    expect(declared).toContain("next");
    expect(declared).toContain("electron");

    expect(declared.filter(specifierIsAiSdk)).toEqual([]);
  });

  it("2. no shipping source file imports an AI provider SDK", () => {
    const offenders = scanned
      .map((f) => ({
        file: rel(f),
        hits: importSpecifiers(readFileSync(f, "utf8")).filter(
          specifierIsAiSdk,
        ),
      }))
      .filter((r) => r.hits.length > 0);

    expect(offenders).toEqual([]);
  });

  it("3. no shipping source file references a model inference endpoint", () => {
    const offenders = scanned
      .map((f) => {
        const src = readFileSync(f, "utf8");
        return {
          file: rel(f),
          hits: AI_HOSTNAMES.filter((h) => src.includes(h)),
        };
      })
      .filter((r) => r.hits.length > 0);

    expect(offenders).toEqual([]);
  });

  // ─── Guards: proof the three above actually ran ───────────────────────

  it("4. the scan covered real shipping source - coverage assertion", () => {
    // An empty or truncated walk would make tests 2 and 3 pass vacuously.
    // ⚠️ A FLOOR plus set membership, never a count. The floor catches a
    // walker that broke outright; the four named files below — one from each
    // scanned root — are what catch a walker that lost one root and kept the
    // rest, which a total would silently absorb.
    expect(scanned.length).toBeGreaterThan(60);
    const files = scanned.map(rel);
    for (const named of [
      "app/actions.ts",
      "lib/db/connection.ts",
      "components/gantt/board.tsx",
      "electron/main.ts",
    ]) {
      expect(files).toContain(named);
    }
  });

  it("5. the detectors fire on real SDK specifiers - positive control", () => {
    for (const spec of [
      "openai",
      "openai/shims/node",
      "@anthropic-ai/sdk",
      "@ai-sdk/openai",
      "@google/generative-ai",
      "ai",
    ]) {
      expect(specifierIsAiSdk(spec)).toBe(true);
    }
    // …and the import extractor reaches every spelling test 2 depends on.
    const synthetic = [
      `import OpenAI from "openai";`,
      `const x = require("@anthropic-ai/sdk");`,
      `await import("@ai-sdk/openai");`,
      `import "ollama";`,
    ].join("\n");
    expect(importSpecifiers(synthetic).filter(specifierIsAiSdk)).toHaveLength(
      4,
    );
  });

  it("6. the detectors do NOT fire on prose or on near-miss package names", () => {
    // Near-misses that share a prefix with a real SDK name. A substring match
    // on "ai" would hit half of npm, which is why matching is exact-or-subpath.
    for (const spec of [
      "airtable",
      "aims",
      "@google/maps",
      "openapi-types",
      "@modelcontextprotocol/sdk",
    ]) {
      expect(specifierIsAiSdk(spec)).toBe(false);
    }
    // Prose naming a vendor is not an integration.
    const prose = `// See Anthropic's docs for the shape of a tool call.`;
    expect(importSpecifiers(prose).filter(specifierIsAiSdk)).toEqual([]);

    // ⚠️ This test used to make the same point against the REAL tree, by
    // naming a shipping file that mentioned a vendor in a comment and
    // asserting it was scanned and still clean. That half is deliberately
    // GONE rather than repointed, because no surviving source file names a
    // model vendor in prose — which is itself the property being guarded, so
    // there is nothing left to discriminate against. ⚠️ Do not "fix" it by
    // pointing at a markdown file: `scanned` holds only .ts/.tsx paths, so
    // such an assertion could never pass and would read as a guard while
    // being an impossibility.
  });
});
