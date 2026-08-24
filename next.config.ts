import type { NextConfig } from "next";

/**
 * Weekloom builds as a self-contained Node server and runs inside Electron on
 * loopback. There is no CDN, no reverse proxy and no origin but 127.0.0.1.
 *
 * `output: "standalone"` is what makes that possible: it emits
 * `.next/standalone/server.js`, which the desktop shell spawns with a PORT it
 * chose at runtime. ⚠️ It deliberately does NOT copy `public/` or
 * `.next/static/`; `scripts/prepare-standalone.mjs` and electron-builder's
 * `extraResources` both place them beside `server.js`, and the app boots to an
 * unstyled page without them.
 *
 * ⚠️ The CSP names NO external origin, and that is load-bearing: "your data
 * never leaves your computer" is a claim this project makes to its users, and
 * `connect-src 'self'` is the runtime that enforces it. An accidental
 * third-party fetch is blocked and logged rather than silently succeeding.
 * `tests/no-cloud-imports.test.ts` fails the build if an `https://` origin
 * appears here.
 *
 * `'unsafe-inline'`/`'unsafe-eval'` in script-src are Next's hydration payload
 * and the no-flash theme bootstrap in `app/layout.tsx`.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            // Nothing in the app asks for any of these, and an empty allowlist
            // is the difference between "we never call it" and "the browser
            // will not let us". ⚠️ A feature that genuinely needs one must
            // widen it to `(self)` here — an empty list blocks the API for
            // EVERY origin including this one, and the call then fails
            // silently rather than prompting.
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), payment=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
