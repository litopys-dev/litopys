/**
 * llm-utils.test.ts — shared LLM-response helpers used by Stage A (episodes.ts)
 * and Stage B (skill-draft.ts).
 */

import { describe, expect, test } from "bun:test";
import { parseKeyedArray, safeReplace, stripCodeFences } from "../src/llm-utils.ts";

// ---------------------------------------------------------------------------
// stripCodeFences
// ---------------------------------------------------------------------------

describe("stripCodeFences", () => {
  test("```json fences are stripped", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("```markdown fences are stripped (any language tag)", () => {
    expect(stripCodeFences("```markdown\n# Title\n```")).toBe("# Title");
  });

  test("bare ``` fences are stripped", () => {
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("unfenced text is returned trimmed", () => {
    expect(stripCodeFences('  {"a":1}  ')).toBe('{"a":1}');
  });

  test("inner fences are preserved when the whole document is fenced", () => {
    const doc = "# Title\n\n```bash\necho hi\n```\n\nDone.";
    expect(stripCodeFences("```markdown\n" + doc + "\n```")).toBe(doc);
  });

  test("text with only a leading fence is not mangled", () => {
    const text = "```json\n{\"a\":1}";
    // No closing fence — returned trimmed as-is
    expect(stripCodeFences(text)).toBe(text.trim());
  });
});

// ---------------------------------------------------------------------------
// safeReplace — $-pattern regression (bug class from 8f23f3b)
// ---------------------------------------------------------------------------

describe("safeReplace", () => {
  test("replaces the needle with the replacement", () => {
    expect(safeReplace("hello {x}!", "{x}", "world")).toBe("hello world!");
  });

  test("$& / $' / $` in replacement are inserted literally (no expansion)", () => {
    const replacement = "grep $& and $' and $` done";
    const result = safeReplace("PROMPT: {payload}", "{payload}", replacement);
    expect(result).toBe(`PROMPT: ${replacement}`);
    // $& expansion would re-inject the needle
    expect(result).not.toContain("{payload}");
  });

  test("$$ in replacement stays literal", () => {
    expect(safeReplace("cost: {n}", "{n}", "$$100")).toBe("cost: $$100");
  });

  test("only the first occurrence of the needle is replaced", () => {
    expect(safeReplace("{x} {x}", "{x}", "a")).toBe("a {x}");
  });
});

// ---------------------------------------------------------------------------
// parseKeyedArray
// ---------------------------------------------------------------------------

describe("parseKeyedArray", () => {
  test("valid {key: [...]} → returns the array", () => {
    expect(parseKeyedArray('{"groups":[{"a":1}]}', "groups")).toEqual([{ a: 1 }]);
  });

  test("works for the episodes key too", () => {
    expect(parseKeyedArray('{"episodes":[]}', "episodes")).toEqual([]);
  });

  test("fenced JSON is unfenced before parsing", () => {
    expect(parseKeyedArray('```json\n{"groups":[1,2]}\n```', "groups")).toEqual([1, 2]);
  });

  test("invalid JSON → null", () => {
    expect(parseKeyedArray("not json", "groups")).toBeNull();
  });

  test("valid JSON, wrong shape (missing key) → null", () => {
    expect(parseKeyedArray('{"foo":1}', "groups")).toBeNull();
  });

  test("key present but not an array → null", () => {
    expect(parseKeyedArray('{"groups":{"a":1}}', "groups")).toBeNull();
  });

  test("top-level array (no wrapping object) → null", () => {
    expect(parseKeyedArray("[1,2,3]", "groups")).toBeNull();
  });

  test("empty string (adapter API-error path) → null", () => {
    expect(parseKeyedArray("", "groups")).toBeNull();
  });
});
