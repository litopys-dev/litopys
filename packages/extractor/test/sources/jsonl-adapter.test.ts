import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JsonlAdapter } from "../../src/sources/jsonl.ts";

const FIXTURE_DIR = path.join(import.meta.dir, "../fixtures/sources");

describe("JsonlAdapter", () => {
  const adapter = new JsonlAdapter();

  // ---------------------------------------------------------------------------
  // match()
  // ---------------------------------------------------------------------------

  describe("match()", () => {
    test("returns true for jsonl: prefix", () => {
      expect(adapter.match("jsonl:/tmp/chat.jsonl")).toBe(true);
    });

    test("returns false for text: prefix", () => {
      expect(adapter.match("text:/tmp/file.txt")).toBe(false);
    });

    test("returns false for claude-code: prefix", () => {
      expect(adapter.match("claude-code:~/.claude/session.jsonl")).toBe(false);
    });

    test("returns false for bare path", () => {
      expect(adapter.match("/tmp/chat.jsonl")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // list()
  // ---------------------------------------------------------------------------

  describe("list()", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-jsonl-test-"));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    test("lists an existing file", async () => {
      const filePath = path.join(tmpDir, "chat.jsonl");
      await fs.writeFile(filePath, '{"role":"user","content":"hi"}', "utf-8");
      const result = await adapter.list(`jsonl:${filePath}`);
      expect(result).toEqual([filePath]);
    });

    test("returns empty array for non-existent file", async () => {
      const result = await adapter.list(`jsonl:${tmpDir}/missing.jsonl`);
      expect(result).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // read()
  // ---------------------------------------------------------------------------

  describe("read()", () => {
    const fixturePath = path.join(FIXTURE_DIR, "chat.jsonl");

    test("converts role/content lines to plain text", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.text).toContain("USER:");
      expect(chunk.text).toContain("ASSISTANT:");
      expect(chunk.text).toContain("Alice");
      expect(chunk.text).toContain("Acme Corp");
    });

    test("formats as ROLE: content pairs", async () => {
      const chunk = await adapter.read(fixturePath);
      const lines = chunk.text.split("\n\n");
      expect(lines[0]).toMatch(/^USER:/);
      expect(lines[1]).toMatch(/^ASSISTANT:/);
    });

    test("skips non-JSON lines gracefully", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-jsonl-skip-"));
      try {
        const filePath = path.join(tmpDir, "mixed.jsonl");
        await fs.writeFile(
          filePath,
          [
            '{"role":"user","content":"hello from Alice"}',
            "not-json-at-all",
            "",
            '{"role":"assistant","content":"hello back"}',
          ].join("\n"),
          "utf-8",
        );
        const chunk = await adapter.read(filePath);
        expect(chunk.text).toContain("hello from Alice");
        expect(chunk.text).toContain("hello back");
        expect(chunk.text).not.toContain("not-json");
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    test("skips lines missing role or content", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-jsonl-partial-"));
      try {
        const filePath = path.join(tmpDir, "partial.jsonl");
        await fs.writeFile(
          filePath,
          [
            '{"role":"user","content":"valid line"}',
            '{"type":"metadata","value":42}',
            '{"role":"assistant"}',
          ].join("\n"),
          "utf-8",
        );
        const chunk = await adapter.read(filePath);
        expect(chunk.text).toBe("USER: valid line");
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    test("returns stable sourceId", async () => {
      const chunk1 = await adapter.read(fixturePath);
      const chunk2 = await adapter.read(fixturePath);
      expect(chunk1.sourceId).toBe(chunk2.sourceId);
    });

    test("byteOffset is 0", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.byteOffset).toBe(0);
    });

    test("sessionId is not set (not in generic JSONL format)", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.sessionId).toBeUndefined();
    });
  });
});
