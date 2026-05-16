// Bi-temporal helpers.
//
// Two time axes are tracked per node:
//   - document time (`updated`): when the fact was last written to the graph.
//   - event time (`occurred_at` / `since` / `until`): when it was true in the world.
//
// As-of queries operate on event time.
import type { AnyNode } from "../schema/index.ts";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Match a leading YYYY-MM-DD on a node id (events are conventionally id-prefixed by date).
const ID_DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})(?:-|$)/;

/**
 * Validate an ISO YYYY-MM-DD string.
 */
export function isIsoDate(s: string): boolean {
  return ISO_DATE_RE.test(s);
}

/**
 * Extract a YYYY-MM-DD date prefix from an event-style id (e.g. "2026-04-22-incident").
 * Returns undefined if id is not date-prefixed.
 */
export function eventDateFromId(id: string): string | undefined {
  const m = id.match(ID_DATE_PREFIX_RE);
  return m?.[1];
}

/**
 * Resolve a node's effective event time. Order:
 *   1. occurred_at (explicit event time)
 *   2. since       (start of validity interval)
 *   3. date prefix in id (for event nodes)
 *   4. updated     (document time fallback)
 *
 * Always returns an ISO date string.
 */
export function resolveOccurredAt(node: AnyNode): string {
  if (node.occurred_at) return node.occurred_at;
  if (node.since) return node.since;
  if (node.type === "event") {
    const fromId = eventDateFromId(node.id);
    if (fromId) return fromId;
  }
  return node.updated;
}

/**
 * Bi-temporal validity check.
 *
 * Returns true when the node is considered valid at `asOf` (event-time).
 * A node is invalid if its validity interval [since, until) does not contain asOf.
 *
 * - `since` undefined => -infinity (no lower bound).
 * - `until` undefined => +infinity (still valid).
 * - The interval is half-open: until = D means the node was valid up to but
 *   not including D. This matches the supersedes auto-close semantics where
 *   B.until = A.since.
 */
export function isValidAsOf(node: AnyNode, asOf: string): boolean {
  if (!ISO_DATE_RE.test(asOf)) {
    throw new Error(`as_of must be ISO date YYYY-MM-DD, got "${asOf}"`);
  }
  if (node.since && node.since > asOf) return false;
  if (node.until && node.until <= asOf) return false;
  return true;
}
