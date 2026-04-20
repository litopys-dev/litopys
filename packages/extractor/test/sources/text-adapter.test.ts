import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TextAdapter } from "../../src/sources/text.ts";

const FIXTURE_DIR = path.join(import.meta.dir, "../fixtures/sources");

describe("TextAdapter", () => {
  const adapter = new TextAdapter();

  // ---------------------------------------------------------------------------
  // match()
  // ---------------------------------------------------------------------------

  describe("match()", () => {
    test("returns true for text: prefix", () => {
      expect(adapter.match("text:/tmp/foo.txt")).toBe(true);
    });

    test("returns true for text: with tilde path", () => {
      expect(adapter.match("text:~/documents/chat.txt")).toBe(true);
    });

    test("returns false for jsonl: prefix", () => {
      expect(adapter.match("jsonl:/tmp/chat.jsonl")).toBe(false);
    });

    test("returns false for claude-code: prefix", () => {
      expect(adapter.match("claude-code:~/.claude/session.jsonl")).toBe(false);
    });

    test("returns false for bare path without prefix", () => {
      expect(adapter.match("/tmp/file.txt")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // list()
  // ---------------------------------------------------------------------------

  describe("list()", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-text-test-"));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    test("lists a single existing file", async () => {
      const filePath = path.join(tmpDir, "hello.txt");
      await fs.writeFile(filePath, "hello world", "utf-8");
      const result = await adapter.list(`text:${filePath}`);
      expect(result).toEqual([filePath]);
    });

    test("returns empty array for non-existent file", async () => {
      const result = await adapter.list(`text:${tmpDir}/does-not-exist.txt`);
      expect(result).toHaveLength(0);
    });

    test("expands glob pattern", async () => {
      await fs.writeFile(path.join(tmpDir, "a.txt"), "a", "utf-8");
      await fs.writeFile(path.join(tmpDir, "b.txt"), "b", "utf-8");
      const result = await adapter.list(`text:${tmpDir}/*.txt`);
      expect(result).toHaveLength(2);
      expect(result.every((f) => f.endsWith(".txt"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // read()
  // ---------------------------------------------------------------------------

  describe("read()", () => {
    const fixturePath = path.join(FIXTURE_DIR, "plain.txt");

    test("reads file content as text", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.text).toContain("Alice");
      expect(chunk.text).toContain("Acme Corp");
    });

    test("returns stable sourceId", async () => {
      const chunk1 = await adapter.read(fixturePath);
      const chunk2 = await adapter.read(fixturePath);
      expect(chunk1.sourceId).toBe(chunk2.sourceId);
      expect(chunk1.sourceId).toHaveLength(16);
    });

    test("sourceId differs for different files", async () => {
      const chunk1 = await adapter.read(fixturePath);
      const chunk2 = await adapter.read(path.join(FIXTURE_DIR, "chat.jsonl"));
      expect(chunk1.sourceId).not.toBe(chunk2.sourceId);
    });

    test("byteOffset is 0 for whole-file read", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.byteOffset).toBe(0);
    });

    test("sessionId is not set (not extractable from plain text)", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.sessionId).toBeUndefined();
    });
  });
});
