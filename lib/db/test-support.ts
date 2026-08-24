import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { closeDb, getDb } from "@/lib/db/connection";

/**
 * A fresh, throwaway database per test case.
 *
 * ⚠️ **A test must never touch a real `~/.weekloom`.** `WEEKLOOM_DATA_DIR` is
 * pointed at a new temp directory before each case and the handle is closed and
 * the directory removed after it, so no test can see another's rows and none can
 * see a developer's.
 *
 * Deliberately NOT named `useTempDb`: the `use` prefix makes eslint's
 * react-hooks rule read it as a React hook and refuse a top-level call.
 *
 * Imported only by `lib/db/**\/*.test.ts`. It is not part of the shipped data
 * layer and nothing under `app/` or `components/` may import it.
 */
export function setUpTempDb(): void {
  let dir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "weekloom-test-"));
    process.env.WEEKLOOM_DATA_DIR = dir;
    // Open eagerly so a case that only reads still gets a migrated database, and
    // so a schema failure surfaces as a setup error rather than as a confusing
    // assertion failure further down.
    getDb();
  });

  afterEach(() => {
    closeDb();
    delete process.env.WEEKLOOM_DATA_DIR;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
}
