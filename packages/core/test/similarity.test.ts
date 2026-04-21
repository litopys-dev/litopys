import { describe, expect, test } from "bun:test";
import {
  aliasOverlap,
  findSimilar,
  idEditSimilarity,
  idSubstringContainment,
  levenshtein,
  scoreSimilarity,
  tagJaccard,
} from "../src/graph/similarity.ts";
import type { AnyNode } from "../src/schema/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkNode(partial: Partial<AnyNode> & Pick<AnyNode, "id" | "type">): AnyNode {
  return {
    updated: "2026-04-21",
    confidence: 1,
    ...partial,
  } as AnyNode;
}

// ---------------------------------------------------------------------------
// Levenshtein
// ---------------------------------------------------------------------------

describe("levenshtein", () => {
  test("equal strings → 0", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  test("empty vs non-empty → length", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  test("single substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  test("insert + substitution", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tag Jaccard
// ---------------------------------------------------------------------------

describe("tagJaccard", () => {
  test("both empty → 0", () => {
    expect(tagJaccard(undefined, undefined)).toBe(0);
    expect(tagJaccard([], [])).toBe(0);
  });

  test("disjoint → 0", () => {
    expect(tagJaccard(["a", "b"], ["c", "d"])).toBe(0);
  });

  test("identical → 1", () => {
    expect(tagJaccard(["a", "b"], ["a", "b"])).toBe(1);
  });

  test("partial overlap", () => {
    // A ∩ B = {a}, A ∪ B = {a, b, c} → 1/3
    const v = tagJaccard(["a", "b"], ["a", "c"]);
    expect(v).toBeCloseTo(1 / 3, 5);
  });

  test("case-insensitive", () => {
    expect(tagJaccard(["A", "B"], ["a", "b"])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// idEditSimilarity
// ---------------------------------------------------------------------------

describe("idEditSimilarity", () => {
  test("identical → 1", () => {
    expect(idEditSimilarity("abc", "abc")).toBe(1);
  });

  test("fully different, same length → 0", () => {
    expect(idEditSimilarity("abc", "xyz")).toBe(0);
  });

  test("near-duplicates score high", () => {
    // lenovo-x240 vs thinkpad-x240 — different but share suffix
    const s = idEditSimilarity("lenovo-x240", "lenovo-x240t");
    expect(s).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// idSubstringContainment
// ---------------------------------------------------------------------------

describe("idSubstringContainment", () => {
  test("identical → 1", () => {
    expect(idSubstringContainment("abc", "abc")).toBe(1);
  });

  test("one contains the other → shorter/longer ratio", () => {
    // "chromadb" (8) ⊂ "chromadb-failure" (16) → 0.5
    expect(idSubstringContainment("chromadb", "chromadb-failure")).toBeCloseTo(0.5, 3);
  });

  test("case-insensitive", () => {
    expect(idSubstringContainment("LITOPYS", "my-litopys-plugin")).toBeGreaterThan(0);
  });

  test("shorter below MIN_SUBSTRING_LEN → 0 (avoid noise from tiny tokens)", () => {
    expect(idSubstringContainment("io", "socket-io")).toBe(0);
  });

  test("no containment → 0", () => {
    expect(idSubstringContainment("foo", "barbaz")).toBe(0);
  });

  test("non-adjacent common prefix does not count (substring is literal)", () => {
    // "auto-save-state" is NOT a substring of "auto-save-project-state" —
    // the common characters are scattered across the middle.
    expect(idSubstringContainment("auto-save-state", "auto-save-project-state")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// aliasOverlap
// ---------------------------------------------------------------------------

describe("aliasOverlap", () => {
  test("id matches alias of other node", () => {
    const a = mkNode({ id: "thinkpad-x240", type: "system" });
    const b = mkNode({ id: "lenovo-x240", type: "system", aliases: ["thinkpad-x240"] });
    expect(aliasOverlap(a, b)).toBe(1);
  });

  test("kebab-case ↔ space variant matches", () => {
    const a = mkNode({ id: "thinkpad-x240", type: "system" });
    const b = mkNode({ id: "laptop-a", type: "system", aliases: ["thinkpad x240"] });
    expect(aliasOverlap(a, b)).toBe(1);
  });

  test("no overlap → 0", () => {
    const a = mkNode({ id: "a-id", type: "system", aliases: ["alpha"] });
    const b = mkNode({ id: "b-id", type: "system", aliases: ["beta"] });
    expect(aliasOverlap(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreSimilarity
// ---------------------------------------------------------------------------

describe("scoreSimilarity", () => {
  test("same id → score 1", () => {
    const a = mkNode({ id: "same", type: "concept" });
    const b = mkNode({ id: "same", type: "concept" });
    const result = scoreSimilarity(a, b);
    expect(result.score).toBe(1);
  });

  test("alias match + same type gives high score", () => {
    const a = mkNode({ id: "thinkpad-x240", type: "system", tags: ["laptop"] });
    const b = mkNode({
      id: "lenovo-x240",
      type: "system",
      aliases: ["thinkpad-x240"],
      tags: ["laptop"],
    });
    const result = scoreSimilarity(a, b);
    expect(result.score).toBeGreaterThanOrEqual(0.75);
    expect(result.reasons.some((r) => r.kind === "alias_match")).toBe(true);
    expect(result.reasons.some((r) => r.kind === "type_match")).toBe(true);
  });

  test("type mismatch applies multiplier", () => {
    const a = mkNode({ id: "alice", type: "person", tags: ["x"] });
    const b = mkNode({ id: "alice", type: "concept", tags: ["x"] });
    const result = scoreSimilarity(a, b);
    // id matches exactly → returns 1 via same-id shortcut
    expect(result.score).toBe(1);
  });

  test("different type, no alias overlap, low score", () => {
    const a = mkNode({ id: "apple", type: "system" });
    const b = mkNode({ id: "orange", type: "concept" });
    const result = scoreSimilarity(a, b);
    expect(result.score).toBeLessThan(0.25);
  });

  test("similar ids + same type → mid score", () => {
    const a = mkNode({ id: "typescript", type: "system" });
    const b = mkNode({ id: "typescript-v5", type: "system" });
    const result = scoreSimilarity(a, b);
    expect(result.score).toBeGreaterThan(0.1);
  });

  test("reasons carry explain strings", () => {
    const a = mkNode({ id: "foo-bar", type: "concept", tags: ["t1", "t2"] });
    const b = mkNode({ id: "foo-bar-v2", type: "concept", tags: ["t1"] });
    const result = scoreSimilarity(a, b);
    expect(result.reasons.length).toBeGreaterThan(0);
    for (const r of result.reasons) {
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });

  test("type_match now contributes positive weight (not just suppresses mismatch penalty)", () => {
    const a = mkNode({ id: "aaaaaa", type: "concept" });
    const b = mkNode({ id: "bbbbbb", type: "concept" });
    const result = scoreSimilarity(a, b);
    const typeMatch = result.reasons.find((r) => r.kind === "type_match");
    expect(typeMatch).toBeDefined();
    expect(typeMatch?.weight).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
  });

  test("regression: auto-save-state ↔ auto-save-project-state clears default threshold", () => {
    // Real observed duplicate from the production graph (2026-04-21).
    // Before the scoring fix this pair landed at 0.330, below the 0.35 threshold.
    const a = mkNode({
      id: "auto-save-state",
      type: "concept",
      tags: ["workflow", "memory"],
    });
    const b = mkNode({
      id: "auto-save-project-state",
      type: "concept",
      tags: ["workflow", "memory", "session-management"],
    });
    const result = scoreSimilarity(a, b);
    expect(result.score).toBeGreaterThan(0.3);
    expect(findSimilar(a, [b])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findSimilar
// ---------------------------------------------------------------------------

describe("findSimilar", () => {
  test("excludes target itself", () => {
    const target = mkNode({ id: "target", type: "system" });
    const results = findSimilar(target, [target]);
    expect(results).toHaveLength(0);
  });

  test("filters by minScore", () => {
    const target = mkNode({ id: "apple", type: "system" });
    const distant = mkNode({ id: "orange", type: "concept" });
    const results = findSimilar(target, [distant], { minScore: 0.5 });
    expect(results).toHaveLength(0);
  });

  test("results are sorted descending by score", () => {
    const target = mkNode({ id: "thinkpad-x240", type: "system", tags: ["laptop"] });
    const strong = mkNode({
      id: "lenovo-x240",
      type: "system",
      aliases: ["thinkpad-x240"],
      tags: ["laptop"],
    });
    const weak = mkNode({ id: "x240-dock", type: "system", tags: ["laptop"] });
    const results = findSimilar(target, [weak, strong], { minScore: 0.1 });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.node.id).toBe("lenovo-x240");
    expect(results[1]?.node.id).toBe("x240-dock");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 1);
  });

  test("respects limit", () => {
    const target = mkNode({ id: "root", type: "concept", tags: ["x"] });
    const candidates: AnyNode[] = [];
    for (let i = 0; i < 20; i++) {
      candidates.push(mkNode({ id: `root-${i}`, type: "concept", tags: ["x"] }));
    }
    const results = findSimilar(target, candidates, { limit: 5, minScore: 0 });
    expect(results).toHaveLength(5);
  });
});
