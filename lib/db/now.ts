/**
 * The one clock the data layer reads.
 *
 * Millisecond precision is sufficient, and that is a deliberate claim rather
 * than an oversight. The hosted database used microsecond timestamps because an
 * optimistic-concurrency guard compared `updated_at` as an opaque string: a JS
 * `Date` round trip truncated to milliseconds, the comparison then never
 * matched, and *every* move became a rejection. That guard does not exist here —
 * there is one writer, so there is nothing to guard against and every rejection
 * would be a false one — and nothing anywhere compares two timestamps for
 * equality.
 *
 * Ordering stability comes from the `, id` tiebreaker on every ordered read in
 * `lib/db/*`, not from clock resolution. Two rows written in the same
 * millisecond still come back in a stable order.
 */
export function nowISO(): string {
  return new Date().toISOString();
}
