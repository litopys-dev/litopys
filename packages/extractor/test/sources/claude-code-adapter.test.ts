import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ClaudeCodeAdapter } from "../../src/sources/claude-code.ts";

const FIXTURE_DIR = path.join(import.meta.dir, "../fixtures/sources");

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter();

  // ---------------------------------------------------------------------------
  // match()
  // ---------------------------------------------------------------------------

  describe("match()", () => {
    test("returns true for claude-code: prefix", () => {
      expect(adapter.match("claude-code:~/.claude/session.jsonl")).toBe(true);
    });

    test("returns true for glob spec", () => {
      expect(adapter.match("claude-code:~/.claude/projects/*/sessions/*.jsonl")).toBe(true);
    });

    test("returns false for text: prefix", () => {
      expect(adapter.match("text:/tmp/file.txt")).toBe(false);
    });

    test("returns false for jsonl: prefix", () => {
      expect(adapter.match("jsonl:/tmp/chat.jsonl")).toBe(false);
    });

    test("returns false for bare path", () => {
      expect(adapter.match("/home/alice/.claude/session.jsonl")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // list()
  // ---------------------------------------------------------------------------

  describe("list()", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-cc-test-"));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    test("lists an existing file", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      await fs.writeFile(filePath, '{"type":"user"}', "utf-8");
      const result = await adapter.list(`claude-code:${filePath}`);
      expect(result).toEqual([filePath]);
    });

    test("returns empty array for non-existent file", async () => {
      const result = await adapter.list(`claude-code:${tmpDir}/missing.jsonl`);
      expect(result).toHaveLength(0);
    });

    test("expands glob across subdirectories", async () => {
      await fs.mkdir(path.join(tmpDir, "proj-a"), { recursive: true });
      await fs.mkdir(path.join(tmpDir, "proj-b"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, "proj-a", "sess.jsonl"), "", "utf-8");
      await fs.writeFile(path.join(tmpDir, "proj-b", "sess.jsonl"), "", "utf-8");
      const result = await adapter.list(`claude-code:${tmpDir}/*/sess.jsonl`);
      expect(result).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // read()
  // ---------------------------------------------------------------------------

  describe("read()", () => {
    const fixturePath = path.join(FIXTURE_DIR, "session.jsonl");

    test("extracts user and assistant text turns", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.text).toContain("USER:");
      expect(chunk.text).toContain("ASSISTANT:");
      expect(chunk.text).toContain("acme-api");
    });

    test("extracts sessionId from events", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.sessionId).toBe("alice-session-001");
    });

    test("skips file-history-snapshot events", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.text).not.toContain("file-history-snapshot");
      expect(chunk.text).not.toContain("trackedFileBackups");
    });

    test("skips thinking blocks from assistant content", async () => {
      const chunk = await adapter.read(fixturePath);
      // Fixture has a thinking block "thinking about bun setup" — should not appear
      expect(chunk.text).not.toContain("thinking about bun setup");
    });

    test("includes text blocks from assistant", async () => {
      const chunk = await adapter.read(fixturePath);
      // The fixture has assistant text about TypeScript strict mode and Bun
      expect(chunk.text).toContain("TypeScript");
      expect(chunk.text).toContain("Bun");
    });

    test("handles string content (not array) in message", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-cc-str-"));
      try {
        const filePath = path.join(tmpDir, "string-content.jsonl");
        const event = {
          type: "user",
          sessionId: "str-session",
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-01-01T10:00:00Z",
          message: { role: "user", content: "Alice works at Acme Corp." },
          cwd: "/home/alice",
          entrypoint: "cli",
          userType: "human",
          version: "1.0",
          isSidechain: false,
          gitBranch: "main",
        };
        await fs.writeFile(filePath, JSON.stringify(event), "utf-8");
        const chunk = await adapter.read(filePath);
        expect(chunk.text).toContain("Alice works at Acme Corp.");
        expect(chunk.sessionId).toBe("str-session");
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    test("returns empty text for empty file", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-cc-empty-"));
      try {
        const filePath = path.join(tmpDir, "empty.jsonl");
        await fs.writeFile(filePath, "", "utf-8");
        const chunk = await adapter.read(filePath);
        expect(chunk.text).toBe("");
        expect(chunk.sessionId).toBeUndefined();
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    test("returns stable sourceId", async () => {
      const chunk1 = await adapter.read(fixturePath);
      const chunk2 = await adapter.read(fixturePath);
      expect(chunk1.sourceId).toBe(chunk2.sourceId);
      expect(chunk1.sourceId).toHaveLength(16);
    });

    test("byteOffset is 0", async () => {
      const chunk = await adapter.read(fixturePath);
      expect(chunk.byteOffset).toBe(0);
    });
  });
});
