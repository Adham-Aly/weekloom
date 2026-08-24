/**
 * Put the two directories `output: "standalone"` leaves behind next to
 * `server.js`.
 *
 * ⚠️ MEASURED, and the reason this script exists: a real standalone build emits
 * `.next/standalone/{server.js, node_modules, .next/{BUILD_ID, manifests,
 * server}}` and **neither `public/` nor `.next/static/`**. Next's own docs say
 * so in as many words. Without them every stylesheet, every JavaScript chunk
 * and the favicon 404, and the app opens as unstyled HTML that mostly works —
 * which is a much more confusing failure than one that does not start at all.
 *
 * `electron-builder.yml`'s `extraResources` does the same job declaratively for
 * the packaged installer. This script serves `npm run app:start` and the
 * Playwright harness, which both run the build straight out of `.next/`.
 *
 * ⚠️ `fs.cpSync`, not `cp -r`: this has to work on Windows.
 */

import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");

/** [source, destination] — both relative to the repository root. */
const COPIES = [
  [
    path.join(root, ".next", "static"),
    path.join(standalone, ".next", "static"),
  ],
  [path.join(root, "public"), path.join(standalone, "public")],
];

// Fail loudly rather than cosmetically. An app that launches unstyled looks
// like a CSS bug; an exit code with a message names the actual cause.
if (!existsSync(standalone)) {
  console.error(
    "prepare-standalone: .next/standalone is missing.\n" +
      'Run `npm run build` first (next.config.ts sets output: "standalone").',
  );
  process.exit(1);
}

for (const [src] of COPIES) {
  if (!existsSync(src)) {
    console.error(
      `prepare-standalone: ${path.relative(root, src)} is missing.\n` +
        "The standalone server cannot serve the app without it. Run `npm run build` first.",
    );
    process.exit(1);
  }
}

for (const [src, dst] of COPIES) {
  cpSync(src, dst, { recursive: true });
  console.log(
    `prepare-standalone: ${path.relative(root, src)} -> ${path.relative(root, dst)}`,
  );
}
