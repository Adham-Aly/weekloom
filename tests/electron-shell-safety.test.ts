import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The desktop shell's security posture, pinned as text.
 *
 * ## Why a source scan
 *
 * `electron/**` is compiled by its own TypeScript project and loaded by
 * Electron, never by vitest — nothing in `npm test` imports it and nothing
 * could, because `app`, `BrowserWindow` and `dialog` only exist inside an
 * Electron process. So the only automated defence that reaches this file is
 * reading it. That is the same reason `tests/no-cloud-imports.test.ts` exists
 * for `components/**`.
 *
 * ## What is pinned, and the failure each prevents
 *
 *  * `sandbox` / `contextIsolation` / `nodeIntegration` — a renderer with Node
 *    access is a web page with a filesystem.
 *  * `http://127.0.0.1`, never `file://` — ⚠️ `crypto.randomUUID` and
 *    `navigator.clipboard` are secure-context-only. On `file://` both are
 *    `undefined` and the board throws the first time somebody creates a task.
 *  * `HOSTNAME` bound to `127.0.0.1` — ⚠️ Next's standalone template defaults
 *    to every interface. Without this line the app serves the user's entire
 *    local database to anyone on their network, silently and successfully.
 *  * external navigation is handed to the OS browser, never opened as a second
 *    Electron window.
 *  * the data directory comes from the home directory, never the working
 *    directory — `server.js` calls `process.chdir()`, so cwd is inside the
 *    application bundle.
 *
 * ## ⚠️ Comments are stripped before the negative assertions, and that is
 * load-bearing
 *
 * This file's subject documents its own traps by NAME: `main.ts`'s comments
 * legitimately contain `0.0.0.0` (quoting Next's default) and `process.cwd()`
 * (warning against it). A scan of the raw text would flag the warnings and the
 * tempting "fix" is to delete the prose that makes the code understandable.
 * Test 6 proves the stripper works in both directions before any of that is
 * believed.
 *
 * ## Mutation test
 *
 * All six run and verified. `sandbox: true` → `sandbox: false` reds test 2.
 * `win.loadURL` → `win.loadFile` reds test 3. Deleting the `HOSTNAME` line reds
 * test 4. Renaming `setWindowOpenHandler` reds test 5, and so does
 * `os.homedir()` → `process.cwd()`. Making `stripComments` return `""` reds all
 * six, i.e. test 6 fails BEFORE 2-5 can pass vacuously.
 *
 * ⚠️ MEASURED during that run, and the reason test 5 uses regexes rather than
 * `String.includes`: with a substring match, renaming the call to
 * `setWindowOpenHandlerX` left the guard GREEN, because the old name is a
 * substring of the new one. Identifier boundaries, always.
 */

const REPO_ROOT = join(__dirname, "..");
const MAIN = join(REPO_ROOT, "electron", "main.ts");
const MENU = join(REPO_ROOT, "electron", "menu.ts");

/**
 * Remove `//` and block comments while leaving string and template literals
 * intact.
 *
 * A naive `replace(/\/\/.*$/gm, "")` would eat the rest of the line starting at
 * the `//` inside `"http://127.0.0.1"` — deleting the very code test 3 looks
 * for and passing for the wrong reason. So this is a character scanner that
 * tracks quotes and escapes. It does not model regex literals; `electron/**`
 * contains none, and test 1's coverage assertion is what keeps that true of the
 * files actually scanned.
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

const rawMain = existsSync(MAIN) ? readFileSync(MAIN, "utf8") : "";
const code = stripComments(rawMain);

describe("the Electron shell is hardened", () => {
  it("1. the shell files exist and were read — coverage assertion", () => {
    // An empty read makes every absence assertion below pass vacuously.
    for (const file of [MAIN, MENU]) {
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8").length).toBeGreaterThan(500);
    }
    expect(code.length).toBeGreaterThan(500);
    expect(code).toContain("BrowserWindow");
  });

  it("2. the renderer is sandboxed, isolated and has no Node", () => {
    expect(code).toMatch(/contextIsolation:\s*true/);
    expect(code).toMatch(/nodeIntegration:\s*false/);
    expect(code).toMatch(/sandbox:\s*true/);
    // ⚠️ Both directions. Asserting only the positives lets a file that says
    // nothing at all about `sandbox` pass; asserting only the negatives lets a
    // file that forgot the option entirely pass.
    expect(code).not.toMatch(/contextIsolation:\s*false/);
    expect(code).not.toMatch(/nodeIntegration:\s*true/);
    expect(code).not.toMatch(/sandbox:\s*false/);
  });

  it("3. the window loads http://127.0.0.1 and never a file:// URL", () => {
    expect(code).toContain("http://127.0.0.1:");
    // ⚠️ Identifier-boundary, never `String.includes`: renaming `loadURL` to
    // `loadURLLater` must fail this, and a substring match would not notice.
    expect(code).toMatch(/\bloadURL\b/);
    expect(code).not.toContain("file://");
    expect(code).not.toContain("loadFile(");
  });

  it("4. the spawned server is bound to loopback", () => {
    expect(code).toMatch(/HOSTNAME:\s*"127\.0\.0\.1"/);
    expect(code).not.toContain("0.0.0.0");
  });

  it("5. navigation is hardened and the data directory is the home directory", () => {
    expect(code).toMatch(/\bsetWindowOpenHandler\b/);
    expect(code).toMatch(/\bwill-navigate\b/);
    expect(code).toContain("os.homedir()");
    expect(code).not.toContain("process.cwd()");
    // The environment is read first, or a throwaway data directory in the
    // tests would be silently ignored.
    expect(code).toMatch(/process\.env\.WEEKLOOM_DATA_DIR\s*\?\?/);
  });

  it("6. the matchers and the comment stripper actually work — controls", () => {
    // Positive: fires on something known present, does not fire on something
    // known absent.
    expect(code).toMatch(/\brequestSingleInstanceLock\b/);
    expect(code).not.toContain("nodeIntegrationInWorker");
    // ⚠️ MEASURED: the boundary is what makes test 5 real. A plain substring
    // match still finds "setWindowOpenHandler" inside "setWindowOpenHandlerX",
    // so renaming the call would leave the guard green.
    expect(/\bsetWindowOpenHandler\b/.test("setWindowOpenHandlerX")).toBe(
      false,
    );
    expect(/\bloadURL\b/.test("loadURLLater")).toBe(false);

    // The stripper removes prose…
    expect(stripComments(`// beware 0.0.0.0\nconst a = 1;`)).not.toContain(
      "0.0.0.0",
    );
    expect(
      stripComments(`/* process.cwd() is wrong */\nconst a = 1;`),
    ).not.toContain("process.cwd()");
    // …and keeps code, INCLUDING a URL whose "//" a naive stripper would eat.
    expect(stripComments(`const u = "http://127.0.0.1:1"; // note`)).toContain(
      'const u = "http://127.0.0.1:1";',
    );
    expect(stripComments(`const s = sandbox; // off`)).toContain("sandbox");

    // And the real file genuinely exercises that: main.ts documents both traps
    // by name in prose while its code does the right thing. If this stops being
    // true the stripper is no longer being tested by the tree it guards.
    expect(rawMain).toContain("0.0.0.0");
    expect(rawMain).toContain("process.cwd()");
  });
});
