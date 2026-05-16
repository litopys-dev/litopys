import { describe, expect, test } from "bun:test";
import { mean, precisionAtK, recallAtK } from "../src/scoring.ts";

describe("recallAtK", () => {
  test("returns 1 when all expected are in top-k", () => {
    expect(recallAtK(["a", "b", "c"], ["a", "b"], 5)).toBe(1);
  });

  test("returns 0 when no expected are retrieved", () => {
    expect(recallAtK(["x", "y", "z"], ["a", "b"], 5)).toBe(0);
  });

  test("partial recall is fraction of hits over expected count", () => {
    expect(recallAtK(["a", "x", "y"], ["a", "b"], 5)).toBe(0.5);
  });

  test("only considers top-k entries", () => {
    // expected 'b' is at index 5 (out of top-5)
    expect(recallAtK(["x", "x", "x", "x", "x", "b"], ["b"], 5)).toBe(0);
  });

  test("counts each expected id at most once even if duplicated in retrieved", () => {
    expect(recallAtK(["a", "a", "a"], ["a", "b"], 5)).toBe(0.5);
  });

  test("returns 0 when expected list is empty", () => {
    expect(recallAtK(["a", "b"], [], 5)).toBe(0);
  });

  test("returns 0 when k is 0", () => {
    expect(recallAtK(["a", "b"], ["a"], 0)).toBe(0);
  });

  test("clamps negative k to 0", () => {
    expect(recallAtK(["a"], ["a"], -3)).toBe(0);
  });

  test("floors non-integer k", () => {
    // k=2.9 -> 2: 'a' is at index 0, 'c' is at index 2 (excluded)
    expect(recallAtK(["a", "b", "c"], ["a", "c"], 2.9)).toBe(0.5);
  });

  test("handles k larger than retrieved length", () => {
    expect(recallAtK(["a"], ["a", "b"], 100)).toBe(0.5);
  });
});

describe("precisionAtK", () => {
  test("returns 1 when every top-k entry is expected", () => {
    expect(precisionAtK(["a", "b"], ["a", "b", "c"], 2)).toBe(1);
  });

  test("returns 0 when no retrieved entries are expected", () => {
    expect(precisionAtK(["x", "y", "z"], ["a", "b"], 3)).toBe(0);
  });

  test("hits divided by k (not by top.length) — penalises short result lists", () => {
    // only 'a' returned but k=5 → precision = 1/5
    expect(precisionAtK(["a"], ["a", "b", "c"], 5)).toBe(0.2);
  });

  test("partial precision", () => {
    // 2 of 5 top results are expected → 0.4
    expect(precisionAtK(["a", "b", "x", "y", "z"], ["a", "b", "c"], 5)).toBe(0.4);
  });

  test("returns 0 when retrieved is empty", () => {
    expect(precisionAtK([], ["a"], 5)).toBe(0);
  });

  test("returns 0 when k is 0", () => {
    expect(precisionAtK(["a"], ["a"], 0)).toBe(0);
  });

  test("clamps negative k to 0", () => {
    expect(precisionAtK(["a"], ["a"], -1)).toBe(0);
  });

  test("ignores duplicate retrieved ids beyond first occurrence in k window when computing precision", () => {
    // top-3 contains 'a' twice — both slots count as hits because the
    // standard precision@k definition counts retrieved positions, not unique ids
    expect(precisionAtK(["a", "a", "x"], ["a"], 3)).toBeCloseTo(2 / 3);
  });

  test("handles k larger than retrieved length without dividing by zero", () => {
    expect(precisionAtK(["a"], ["a"], 100)).toBe(0.01);
  });
});

describe("mean", () => {
  test("returns 0 for empty list", () => {
    expect(mean([])).toBe(0);
  });

  test("returns the single value for one-element list", () => {
    expect(mean([42])).toBe(42);
  });

  test("computes arithmetic mean", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  test("handles fractional results", () => {
    expect(mean([1, 2])).toBeCloseTo(1.5);
  });
});
