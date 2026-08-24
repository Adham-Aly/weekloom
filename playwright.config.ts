import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, DATA_DIR, PORT } from "./e2e/env";

/**
 * End-to-end configuration.
 *
 * ⚠️ **This suite drives the real production build**, the same
 * `.next/standalone/server.js` the desktop shell spawns — never `next dev`.
 * `e2e/serve.mjs` is the command, and it refuses to start if the build is
 * missing. That matters because `components/**` and `electron/**` are outside
 * `vitest.config.ts`'s include, so this layer is the ONLY automated thing that
 * reaches the board, the routing, the Server Action wire format and the
 * "nothing leaves this machine" claim.
 *
 * ⚠️ **`WEEKLOOM_DATA_DIR` points at a throwaway temp directory, and that is a
 * hard requirement rather than a nicety.** The suite creates, drags and deletes;
 * against the developer's real `~/.weekloom` it would destroy their boards.
 * `e2e/env.ts` picks the path and `e2e/serve.mjs` refuses any path outside the
 * OS temp directory.
 *
 * ⚠️ **One worker, no parallelism.** There is one SQLite file and one server
 * process; two workers would be two writers racing over one board list, and the
 * failures would look like flaky assertions rather than like the design error
 * they are.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node ${JSON.stringify("e2e/serve.mjs")}`,
    url: `${BASE_URL}/api/health`,
    env: {
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      WEEKLOOM_DATA_DIR: DATA_DIR,
      NODE_ENV: "production",
    },
    // ⚠️ Never reuse: a server already running is a server with somebody
    // else's data directory, and the suite would silently test that instead.
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  },
});
