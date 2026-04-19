import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeNode } from "@litopys/core";
import type { CandidateNode, CandidateRelation } from "../src/adapters/types.ts";
import {
  listQuarantineFrom,
  promoteCandidate,
  rejectCandidate,
  writeQuarantineTo,
} from "../src/quarantine.ts";
import type { QuarantineMeta } from "../src/quarantine.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeCandidateNode(overrides: Partial<CandidateNode> = {}): CandidateNode {
  return {
    id: "test-concept",
    type: "concept",
    summary: "A test concept",
    confidence: 0.8,
    reasoning: "Found in session transcript",
    sourceSessionId: "sess-001",
    ...overrides,
  };
}

function makeCandidateRelation(overrides: Partial<CandidateRelation> = {}): CandidateRelation {
  return {
    type: "uses",
    sourceId: "test-project",
    targetId: "test-concept",
    confidence: 0.75,
    reasoning: "Project references this concept",
    sourceSessionId: "sess-001",
    ...overrides,
  };
}

function makeMeta(overrides: Partial<QuarantineMeta> = {}): QuarantineMeta {
  return {
    sessionId: "sess-001",
    timestamp: "2024-01-15T10:00:00.000Z",
    adapterName: "anthropic",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("writeQuarantineTo", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("creates quarantine file", async () => {
    const candidates = [makeCandidateNode()];
    const relations = [makeCandidateRelation()];
    const meta = makeMeta();

    const filePath = await writeQuarantineTo(candidates, relations, meta, tmpDir);
    expect(filePath).toContain(tmpDir);
    expect(filePath).toEndWith(".md");

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("sess-001");
    expect(content).toContain("anthropic");
  });

  test("file contains YAML frontmatter", async () => {
    const filePath = await writeQuarantineTo([makeCandidateNode()], [], makeMeta(), tmpDir);
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("sessionId:");
    expect(content).toContain("timestamp:");
    expect(content).toContain("adapterName:");
  });

  test("file contains JSON code block with candidates", async () => {
    const candidates = [makeCandidateNode({ id: "unique-concept-id" })];
    const filePath = await writeQuarantineTo(candidates, [], makeMeta(), tmpDir);
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("unique-concept-id");
    expect(content).toContain("```json");
  });

  test("creates directory if it doesn't exist", async () => {
    const nestedDir = path.join(tmpDir, "nested", "quarantine");
    const filePath = await writeQuarantineTo([makeCandidateNode()], [], makeMeta(), nestedDir);
    expect(filePath).toContain(nestedDir);
    const stat = await fs.stat(nestedDir);
    expect(stat.isDirectory()).toBe(true);
  });

  test("filename includes timestamp and session id", async () => {
    const meta = makeMeta({ sessionId: "my-session", timestamp: "2024-01-15T10:00:00.000Z" });
    const filePath = await writeQuarantineTo([], [], meta, tmpDir);
    expect(path.basename(filePath)).toContain("my-session");
    expect(path.basename(filePath)).toContain("2024");
  });

  test("handles empty candidates and relations", async () => {
    const filePath = await writeQuarantineTo([], [], makeMeta(), tmpDir);
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("candidateCount");
  });
});

describe("listQuarantineFrom", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array when directory doesn't exist", async () => {
    const result = await listQuarantineFrom(path.join(tmpDir, "nonexistent"));
    expect(result).toHaveLength(0);
  });

  test("returns empty array for empty directory", async () => {
    const result = await listQuarantineFrom(tmpDir);
    expect(result).toHaveLength(0);
  });

  test("returns parsed quarantine files", async () => {
    await writeQuarantineTo([makeCandidateNode()], [], makeMeta({ sessionId: "s1" }), tmpDir);
    await writeQuarantineTo(
      [makeCandidateNode({ id: "second-concept" })],
      [],
      makeMeta({ sessionId: "s2", timestamp: "2024-01-16T10:00:00.000Z" }),
      tmpDir,
    );

    const result = await listQuarantineFrom(tmpDir);
    expect(result).toHaveLength(2);
  });

  test("parsed file has correct meta", async () => {
    const meta = makeMeta({ sessionId: "test-session-id", adapterName: "ollama" });
    await writeQuarantineTo([makeCandidateNode()], [], meta, tmpDir);

    const result = await listQuarantineFrom(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.meta.sessionId).toBe("test-session-id");
    expect(result[0]?.meta.adapterName).toBe("ollama");
  });

  test("parsed file has correct candidates", async () => {
    const candidates = [
      makeCandidateNode({ id: "concept-alpha" }),
      makeCandidateNode({ id: "concept-beta", type: "lesson" }),
    ];
    await writeQuarantineTo(candidates, [], makeMeta(), tmpDir);

    const result = await listQuarantineFrom(tmpDir);
    expect(result[0]?.candidates).toHaveLength(2);
    expect(result[0]?.candidates[0]?.id).toBe("concept-alpha");
    expect(result[0]?.candidates[1]?.id).toBe("concept-beta");
  });

  test("parsed file has correct relations", async () => {
    const relations = [makeCandidateRelation(), makeCandidateRelation({ type: "depends_on" })];
    await writeQuarantineTo([], relations, makeMeta(), tmpDir);

    const result = await listQuarantineFrom(tmpDir);
    expect(result[0]?.relations).toHaveLength(2);
  });

  test("ignores non-.md files", async () => {
    await fs.writeFile(path.join(tmpDir, "not-quarantine.json"), "{}", "utf-8");
    await fs.writeFile(path.join(tmpDir, "not-quarantine.txt"), "text", "utf-8");
    await writeQuarantineTo([makeCandidateNode()], [], makeMeta(), tmpDir);

    const result = await listQuarantineFrom(tmpDir);
    expect(result).toHaveLength(1);
  });
});

describe("promoteCandidate", () => {
  let tmpDir: string;
  let graphDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-test-"));
    graphDir = path.join(tmpDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("promotes candidate to real graph", async () => {
    const qDir = path.join(tmpDir, "quarantine");
    const candidate = makeCandidateNode({ id: "promoted-concept" });
    const filePath = await writeQuarantineTo([candidate], [], makeMeta(), qDir);

    await promoteCandidate(filePath, 0, graphDir);

    // Check node was written to graph
    const conceptFile = path.join(graphDir, "concepts", "promoted-concept.md");
    const stat = await fs.stat(conceptFile);
    expect(stat.isFile()).toBe(true);
  });

  test("removes candidate from quarantine file after promote", async () => {
    const qDir = path.join(tmpDir, "quarantine");
    const candidates = [
      makeCandidateNode({ id: "to-promote" }),
      makeCandidateNode({ id: "stays" }),
    ];
    const filePath = await writeQuarantineTo(candidates, [], makeMeta(), qDir);

    await promoteCandidate(filePath, 0, graphDir);

    const result = await listQuarantineFrom(qDir);
    expect(result[0]?.candidates).toHaveLength(1);
    expect(result[0]?.candidates[0]?.id).toBe("stays");
  });

  test("deletes quarantine file when all candidates promoted", async () => {
    const qDir = path.join(tmpDir, "quarantine");
    const filePath = await writeQuarantineTo([makeCandidateNode()], [], makeMeta(), qDir);

    await promoteCandidate(filePath, 0, graphDir);

    await expect(fs.stat(filePath)).rejects.toThrow();
  });

  test("throws on invalid candidate index", async () => {
    const qDir = path.join(tmpDir, "quarantine");
    const filePath = await writeQuarantineTo([makeCandidateNode()], [], makeMeta(), qDir);

    await expect(promoteCandidate(filePath, 99, graphDir)).rejects.toThrow(/index 99/);
  });

  test("promotes person node correctly", async () => {
    const qDir = path.join(tmpDir, "quarantine");
    const candidate = makeCandidateNode({ id: "john-doe", type: "person", summary: "Test person" });
    const filePath = await writeQuarantineTo([candidate], [], makeMeta(), qDir);

    await promoteCandidate(filePath, 0, graphDir);

    const personFile = path.join(graphDir, "people", "john-doe.md");
    const stat = await fs.stat(personFile);
    expect(stat.isFile()).toBe(true);
  });
});

describe("rejectCandidate", () => {
  let tmpDir: string;
  let graphDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-test-"));
    graphDir = path.join(tmpDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("removes candidate from quarantine file", async () => {
    const qDir = path.join(graphDir, "..", "quarantine");
    const candidates = [
      makeCandidateNode({ id: "to-reject" }),
      makeCandidateNode({ id: "keeper" }),
    ];
    const filePath = await writeQuarantineTo(candidates, [], makeMeta(), qDir);

    await rejectCandidate(filePath, 0, graphDir, "not relevant");

    const result = await listQuarantineFrom(qDir);
    expect(result[0]?.candidates).toHaveLength(1);
    expect(result[0]?.candidates[0]?.id).toBe("keeper");
  });

  test("logs rejection to rejected.jsonl", async () => {
    const qDir = path.join(graphDir, "..", "quarantine");
    const filePath = await writeQuarantineTo(
      [makeCandidateNode({ id: "reject-me" })],
      [],
      makeMeta(),
      qDir,
    );

    await rejectCandidate(filePath, 0, graphDir, "test reason");

    const logPath = path.join(graphDir, "..", "quarantine", "rejected.jsonl");
    const content = await fs.readFile(logPath, "utf-8");
    expect(content).toContain("reject-me");
    expect(content).toContain("test reason");
  });

  test("works without a reason argument", async () => {
    const qDir = path.join(graphDir, "..", "quarantine");
    const filePath = await writeQuarantineTo([makeCandidateNode()], [], makeMeta(), qDir);

    await expect(rejectCandidate(filePath, 0, graphDir)).resolves.toBeUndefined();
  });

  test("deletes quarantine file when all candidates rejected", async () => {
    const qDir = path.join(graphDir, "..", "quarantine");
    const filePath = await writeQuarantineTo([makeCandidateNode()], [], makeMeta(), qDir);

    await rejectCandidate(filePath, 0, graphDir, "all gone");

    await expect(fs.stat(filePath)).rejects.toThrow();
  });

  test("throws on invalid candidate index", async () => {
    const qDir = path.join(graphDir, "..", "quarantine");
    const filePath = await writeQuarantineTo([makeCandidateNode()], [], makeMeta(), qDir);

    await expect(rejectCandidate(filePath, 5, graphDir)).rejects.toThrow(/index 5/);
  });

  test("rejection log entry is valid JSON", async () => {
    const qDir = path.join(graphDir, "..", "quarantine");
    const filePath = await writeQuarantineTo(
      [makeCandidateNode({ id: "logged-node" })],
      [],
      makeMeta({ sessionId: "sess-abc" }),
      qDir,
    );

    await rejectCandidate(filePath, 0, graphDir, "because");

    const logPath = path.join(graphDir, "..", "quarantine", "rejected.jsonl");
    const line = (await fs.readFile(logPath, "utf-8")).trim();
    const parsed = JSON.parse(line) as {
      candidateId: string;
      sessionId: string;
      reason: string;
    };
    expect(parsed.candidateId).toBe("logged-node");
    expect(parsed.sessionId).toBe("sess-abc");
    expect(parsed.reason).toBe("because");
  });
});
