import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        {
          // `as unknown as X` is a sledgehammer that defeats the type system.
          // Use a real cast, fix the source type, or validate at runtime.
          selector:
            "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
          message:
            "Avoid `as unknown as X` — fix the source type or validate at the boundary.",
        },
      ],
      // ── React Compiler advisories ─────────────────────────────────────
      // The Compiler plugin surfaces real tech debt (cascading renders from
      // reset-on-open modals, hand-rolled memoization the compiler can't
      // preserve, refs accessed during render). All pre-date the rule
      // landing in Next 16; surface as warnings so they stay visible and get
      // addressed during the board.tsx refactor.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    // ── Only the data layer may open the database ────────────────────────
    //
    // `lib/db/connection.ts` owns the single `DatabaseSync` handle: it creates
    // `~/.weekloom`, sets foreign_keys/journal_mode/busy_timeout, and runs any
    // pending migration before returning. A module that opens its own handle
    // gets none of that — most sharply, FK enforcement is a PER-CONNECTION
    // pragma, so a second handle silently turns every `ON DELETE CASCADE` into
    // a no-op and `deleteBlock` starts orphaning items into lanes that do not
    // exist. Route everything through `lib/db/**`.
    files: ["app/**/*.ts", "app/**/*.tsx", "components/**", "lib/**/*.ts"],
    ignores: ["lib/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:sqlite",
              message:
                "Only lib/db/** may open the database — see lib/db/connection.ts. A second connection loses PRAGMA foreign_keys and silently disables every cascade.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "electron/dist/**",
    "release/**",
    "playwright-report/**",
    "test-results/**",
    // Agent skills live under `.agents/`, harness-agnostic; `.claude/skills` is
    // a symlink to them for the one tool that still only reads `.claude/`, and
    // worktrees land there too. Never lint either — and keep BOTH entries: the
    // symlink means a walker that follows it would otherwise reach the same
    // files by a second path.
    ".agents/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
