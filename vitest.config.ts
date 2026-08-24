import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    // `e2e/**` holds Playwright specs, which drive the packaged desktop app and
    // must never be collected by vitest — they use a different runner and would
    // fail on `test.describe` alone.
    exclude: ["node_modules/**", "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` resolves to a module that throws unless the bundler picks
      // the "react-server" condition, which vitest does not. Point it at the
      // package's own empty stub — the one Next itself uses in RSC — so the
      // guard stays real in the app and stops being a wall in tests.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
