export const dynamic = "force-dynamic";

/**
 * Readiness probe.
 *
 * The desktop shell spawns the Next server on an ephemeral loopback port and
 * polls this until it answers, so the user never sees a connection-refused
 * page while the server is still coming up. Playwright's `webServer.url` waits
 * on it for the same reason.
 *
 * ⚠️ It deliberately does NOT touch the database. It answers exactly one
 * question — "is the HTTP server accepting requests?" — and conflating that
 * with "is the data layer healthy?" would make a failed migration look like a
 * slow boot: the shell would keep polling until its timeout and then report a
 * startup timeout instead of the real error, which `instrumentation.ts` has
 * already logged.
 */
export function GET() {
  return Response.json({ ok: true });
}
