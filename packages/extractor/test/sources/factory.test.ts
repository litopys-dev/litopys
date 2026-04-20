import { describe, expect, test } from "bun:test";
import { registeredAdapterNames, selectAdapter } from "../../src/sources/factory.ts";

describe("selectAdapter", () => {
  test("selects TextAdapter for text: prefix", () => {
    const adapter = selectAdapter("text:/tmp/file.txt");
    expect(adapter).toBeDefined();
    expect(adapter?.name).toBe("text");
  });

  test("selects JsonlAdapter for jsonl: prefix", () => {
    const adapter = selectAdapter("jsonl:/tmp/chat.jsonl");
    expect(adapter).toBeDefined();
    expect(adapter?.name).toBe("jsonl");
  });

  test("selects ClaudeCodeAdapter for claude-code: prefix", () => {
    const adapter = selectAdapter("claude-code:~/.claude/projects/abc.jsonl");
    expect(adapter).toBeDefined();
    expect(adapter?.name).toBe("claude-code");
  });

  test("returns undefined for unknown prefix", () => {
    const adapter = selectAdapter("cursor:/tmp/session.jsonl");
    expect(adapter).toBeUndefined();
  });

  test("returns undefined for bare path (no prefix)", () => {
    const adapter = selectAdapter("/tmp/file.txt");
    expect(adapter).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    const adapter = selectAdapter("");
    expect(adapter).toBeUndefined();
  });

  test("is case-sensitive on prefix", () => {
    const adapter = selectAdapter("TEXT:/tmp/file.txt");
    expect(adapter).toBeUndefined();
  });
});

describe("registeredAdapterNames", () => {
  test("returns list of adapter names", () => {
    const names = registeredAdapterNames();
    expect(names).toContain("text");
    expect(names).toContain("jsonl");
    expect(names).toContain("claude-code");
  });

  test("returns at least 3 adapters", () => {
    const names = registeredAdapterNames();
    expect(names.length).toBeGreaterThanOrEqual(3);
  });
});
