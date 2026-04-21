/**
 * Deterministic similarity scoring for graph nodes.
 *
 * Goal: surface merge candidates without embeddings. Pure string/set ops —
 * alias overlap, type match, tag Jaccard, id edit-distance. Reasons are
 * captured alongside the score so `litopys similar --explain` can show the
 * matcher's thinking.
 */

import type { AnyNode } from "../schema/index.ts";

export interface SimilarityReason {
  kind:
    | "alias_match"
    | "type_match"
    | "type_mismatch"
    | "tag_jaccard"
    | "id_edit_distance"
    | "id_substring";
  weight: number;
  detail: string;
}

export interface SimilarityResult {
  node: AnyNode;
  score: number;
  reasons: SimilarityReason[];
}

const ALIAS_WEIGHT = 0.5;
const ID_EDIT_WEIGHT = 0.25;
const TAG_WEIGHT = 0.25;
const TYPE_MATCH_BONUS = 0.1;
const SUBSTRING_WEIGHT = 0.15;
const MIN_SUBSTRING_LEN = 5;
const TYPE_MISMATCH_MULTIPLIER = 0.4;

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Score the similarity between two nodes. Self-comparison returns 1.
 * Returns a score in [0..1] plus the list of reasons that contributed.
 */
export function scoreSimilarity(a: AnyNode, b: AnyNode): SimilarityResult {
  if (a.id === b.id) {
    return {
      node: b,
      score: 1,
      reasons: [{ kind: "alias_match", weight: 1, detail: "same id" }],
    };
  }

  const reasons: SimilarityReason[] = [];
  let weightedSum = 0;

  const aliasSignal = aliasOverlap(a, b);
  if (aliasSignal > 0) {
    weightedSum += aliasSignal * ALIAS_WEIGHT;
    reasons.push({
      kind: "alias_match",
      weight: aliasSignal * ALIAS_WEIGHT,
      detail: aliasSignal === 1 ? "exact alias or id match" : "partial alias overlap",
    });
  }

  const idEdit = idEditSimilarity(a.id, b.id);
  if (idEdit > 0.5) {
    const contribution = idEdit * ID_EDIT_WEIGHT;
    weightedSum += contribution;
    reasons.push({
      kind: "id_edit_distance",
      weight: contribution,
      detail: `id edit-similarity ${idEdit.toFixed(2)} (${a.id} ↔ ${b.id})`,
    });
  }

  const containment = idSubstringContainment(a.id, b.id);
  if (containment > 0) {
    const contribution = containment * SUBSTRING_WEIGHT;
    weightedSum += contribution;
    reasons.push({
      kind: "id_substring",
      weight: contribution,
      detail: `id-substring ${containment.toFixed(2)} (${a.id} ↔ ${b.id})`,
    });
  }

  const jaccard = tagJaccard(a.tags, b.tags);
  if (jaccard > 0) {
    const contribution = jaccard * TAG_WEIGHT;
    weightedSum += contribution;
    reasons.push({
      kind: "tag_jaccard",
      weight: contribution,
      detail: `tag Jaccard ${jaccard.toFixed(2)}`,
    });
  }

  if (a.type === b.type) {
    weightedSum += TYPE_MATCH_BONUS;
    reasons.push({
      kind: "type_match",
      weight: TYPE_MATCH_BONUS,
      detail: `both ${a.type}`,
    });
  }

  let score = Math.min(weightedSum, 1);

  if (a.type !== b.type) {
    score *= TYPE_MISMATCH_MULTIPLIER;
    reasons.push({
      kind: "type_mismatch",
      weight: 0,
      detail: `types differ: ${a.type} vs ${b.type} (score × ${TYPE_MISMATCH_MULTIPLIER})`,
    });
  }

  return { node: b, score, reasons };
}

export interface FindSimilarOptions {
  /** Minimum score to include. Default 0.25. */
  minScore?: number;
  /** Max results. Default 10. */
  limit?: number;
}

/**
 * Rank all other nodes by similarity to target.
 * Excludes the target itself.
 */
export function findSimilar(
  target: AnyNode,
  all: Iterable<AnyNode>,
  opts: FindSimilarOptions = {},
): SimilarityResult[] {
  const minScore = opts.minScore ?? 0.25;
  const limit = opts.limit ?? 10;

  const results: SimilarityResult[] = [];
  for (const candidate of all) {
    if (candidate.id === target.id) continue;
    const result = scoreSimilarity(target, candidate);
    if (result.score >= minScore) results.push(result);
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Signals (internal, exported for tests)
// ---------------------------------------------------------------------------

export function aliasOverlap(a: AnyNode, b: AnyNode): number {
  const aAliases = normaliseAliases(a);
  const bAliases = normaliseAliases(b);
  if (aAliases.size === 0 || bAliases.size === 0) return 0;

  for (const alias of aAliases) {
    if (bAliases.has(alias)) return 1;
  }
  return 0;
}

export function tagJaccard(aTags?: string[], bTags?: string[]): number {
  if (!aTags?.length || !bTags?.length) return 0;
  const a = new Set(aTags.map((t) => t.toLowerCase()));
  const b = new Set(bTags.map((t) => t.toLowerCase()));
  let intersect = 0;
  for (const tag of a) {
    if (b.has(tag)) intersect++;
  }
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export function idEditSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

/**
 * Substring-containment signal: returns `shorter.length / longer.length` if one
 * id is a substring of the other (both ≥ MIN_SUBSTRING_LEN), else 0.
 *
 * Levenshtein alone doesn't distinguish "one id extends the other" from
 * "ids differ in the same number of positions scattered across both strings."
 * The former is a much stronger duplicate signal (e.g. `chromadb` ⊂
 * `chromadb-failure`), so we surface it as its own reason.
 */
export function idSubstringContainment(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower === bLower) return 1;
  const [shorter, longer] = aLower.length <= bLower.length ? [aLower, bLower] : [bLower, aLower];
  if (shorter.length < MIN_SUBSTRING_LEN) return 0;
  if (!longer.includes(shorter)) return 0;
  return shorter.length / longer.length;
}

// ---------------------------------------------------------------------------
// Levenshtein (iterative, O(m*n) time, O(min(m,n)) space)
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length] ?? 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseAliases(node: AnyNode): Set<string> {
  const set = new Set<string>();
  set.add(node.id.toLowerCase());
  for (const alias of node.aliases ?? []) {
    set.add(alias.toLowerCase());
    // Treat kebab-case and space-separated variants as equivalent for alias match
    set.add(alias.toLowerCase().replace(/\s+/g, "-"));
    set.add(alias.toLowerCase().replace(/-/g, " "));
  }
  if (node.summary) {
    const normalized = node.summary.toLowerCase().trim();
    if (normalized.length > 0 && normalized.length < 80) {
      set.add(normalized);
      set.add(normalized.replace(/\s+/g, "-"));
    }
  }
  return set;
}
