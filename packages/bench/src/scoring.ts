/**
 * Retrieval-metric helpers — pure functions, no I/O.
 *
 * All metrics operate on:
 *   retrieved  — the ordered list of node ids returned by the system under test
 *   expected   — the (unordered) set of node ids the dataset declares as correct
 *
 * recallAtK and precisionAtK both clamp k to non-negative integers and
 * return 0 when there are no expected ids (recall) or no retrieved ids
 * (precision). This matches the convention used by most IR papers and
 * avoids NaN propagating into the aggregate report.
 */

export function recallAtK(retrieved: string[], expected: string[], k: number): number {
  const safeK = clampK(k);
  if (expected.length === 0) return 0;
  if (safeK === 0) return 0;
  const top = new Set(retrieved.slice(0, safeK));
  let hits = 0;
  for (const id of expected) {
    if (top.has(id)) hits += 1;
  }
  return hits / expected.length;
}

export function precisionAtK(retrieved: string[], expected: string[], k: number): number {
  const safeK = clampK(k);
  if (safeK === 0) return 0;
  const top = retrieved.slice(0, safeK);
  if (top.length === 0) return 0;
  const expectedSet = new Set(expected);
  let hits = 0;
  for (const id of top) {
    if (expectedSet.has(id)) hits += 1;
  }
  // Denominator is k, not top.length — when the system returns fewer than k
  // results, the "missing slots" still count as misses, which is the standard
  // precision@k definition.
  return hits / safeK;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function clampK(k: number): number {
  if (!Number.isFinite(k)) return 0;
  if (k < 0) return 0;
  return Math.floor(k);
}
