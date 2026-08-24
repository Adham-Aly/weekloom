import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The packaged installer contains an application that can actually start.
 *
 * ⚠️ **Why this guard exists, measured rather than imagined.** `npm run package`
 * produced a 197 MB DMG, exited 0, printed nothing alarming — and the
 * application inside it was dead. `extraResources` copied `.next/standalone`
 * but NOT its `node_modules`, because copying a directory does not bring that
 * one across, so `server.js` died on its first statement with
 * `Error: Cannot find module 'next'`. The desktop shell then spent its three
 * start attempts on it and showed "The Weekloom server did not become ready
 * after three attempts."
 *
 * Nothing else in this repository could have caught that. `npm run build`,
 * `npm run typecheck`, `npm test` and the whole Playwright suite all run
 * against the UNPACKAGED tree, where `.next/standalone/node_modules` is
 * sitting right there; the failure exists only in the artifact a user
 * downloads. This file reads the packaging configuration as TEXT — the same
 * idiom as `tests/electron-shell-safety.test.ts`, and for the same reason:
 * the property is invisible to every other gate and catastrophic when wrong.
 *
 * ⚠️ **This is a weaker check than launching the artifact, and it is not a
 * substitute for it.** It can only prove the configuration still says the
 * right thing. `.agents/skills/build-electron-app/SKILL.md` carries the
 * command that runs the packaged `server.js` directly and is the real check;
 * run it before reporting a successful package.
 *
 * MUTATION TEST, executed while writing this file: deleting the
 * `- from: .next/standalone/node_modules` entry reds test 2; deleting
 * `- "!node_modules/**\/*"` from `files:` reds test 3.
 */

const REPO_ROOT = join(__dirname, "..");
const CONFIG = join(REPO_ROOT, "electron-builder.yml");

/**
 * YAML comments removed, so a requirement described in PROSE can never satisfy
 * an assertion about configuration. This file's comments legitimately discuss
 * `node_modules` and `.next/standalone` at length, which is exactly the trap.
 *
 * Every comment in `electron-builder.yml` is a whole-line comment (test 5
 * asserts the raw file still contains one, so this stripper stays exercised by
 * the very tree it guards).
 */
export function stripYamlComments(src: string): string {
  return src
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const raw = existsSync(CONFIG) ? readFileSync(CONFIG, "utf8") : "";
const config = stripYamlComments(raw);

describe("the packaged app is complete enough to start", () => {
  it("1. the packaging config exists and was read — coverage assertion", () => {
    // An empty read would make every absence assertion below pass vacuously.
    expect(existsSync(CONFIG)).toBe(true);
    expect(raw.length).toBeGreaterThan(500);
    expect(config).toContain("extraResources");
    expect(config).toContain("appId");
  });

  it("2. ⚠️ the Next server's own node_modules is shipped beside server.js", () => {
    // THE REGRESSION ITSELF. Without this entry the installer builds fine and
    // the application cannot start.
    expect(config).toMatch(/from:\s*\.next\/standalone\/node_modules/);
    expect(config).toMatch(/to:\s*app\/node_modules/);
  });

  it("3. ⚠️ node_modules stays OUT of the asar archive", () => {
    // electron-builder copies the production dependency tree into the asar
    // unless it is explicitly excluded, and `files:` patterns alone do not
    // exclude it. Measured without the negation: a 234 MB asar holding 21,502
    // entries nothing loads, plus `@img/sharp` and `@next/swc` native binaries
    // and a 95 MB `app.asar.unpacked/` — the native-addon machinery this
    // project avoids by using `node:sqlite`.
    expect(config).toMatch(/["']!node_modules\/\*\*\/\*["']/);
  });

  it("4. ⚠️ the Next server ships OUTSIDE the asar, and nothing unpacks a native module", () => {
    // `server.js` calls `process.chdir(__dirname)` and you cannot chdir into
    // an asar archive, so `.next` must never appear in `files:`.
    expect(config).toMatch(/from:\s*\.next\/standalone\s*$/m);
    expect(config).toMatch(/to:\s*app\s*$/m);
    // No native dependency, therefore no unpack step. If this ever needs to
    // change, `AGENTS.md` and the build skill change with it.
    expect(config).not.toContain("asarUnpack");
    // The two directories `output: "standalone"` does not copy.
    expect(config).toMatch(/from:\s*\.next\/static/);
    expect(config).toMatch(/from:\s*public/);
  });

  it("5. the comment stripper and the matchers actually work — controls", () => {
    // POSITIVE control on the stripper: it removes a whole-line comment...
    expect(
      stripYamlComments("# from: .next/standalone/node_modules\na: 1"),
    ).not.toContain("standalone");
    // ...and NEGATIVE control: it does not eat real configuration.
    expect(stripYamlComments("from: .next/standalone # note")).toContain(
      ".next/standalone",
    );

    // ⚠️ The raw file really does discuss `node_modules` in prose, so the
    // stripper above is doing real work rather than being a no-op that happens
    // to pass. If this ever fails, the comments were removed and tests 2-4
    // stopped being able to tell configuration from documentation.
    expect(raw).toMatch(/^\s*#.*node_modules/m);
    expect(raw.split("\n").length).toBeGreaterThan(config.split("\n").length);
  });
});
