import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeNode } from "@litopys/core";
import type { CandidateNode, CandidateRelation } from "../src/adapters/types.ts";
import { dedupCandidatesAgainstGraph } from "../src/dedup.ts";

function cand(overrides: Partial<CandidateNode> = {}): CandidateNode {
  return {
    id: "new-concept",
    type: "concept",
    summary: "A fresh candidate",
    confidence: 0.8,
    reasoning: "seen once in transcript",
    sourceSessionId: "sess-1",
    ...overrides,
  };
}

function rel(overrides: Partial<CandidateRelation> = {}): CandidateRelation {
  return {
    type: "uses",
    sourceId: "a",
    targetId: "b",
    confidence: 0.7,
    reasoning: "…",
    sourceSessionId: "sess-1",
    ...overrides,
  };
}

describe("dedupCandidatesAgainstGraph", () => {
  let tmpGraph: string;

  beforeEach(async () => {
    tmpGraph = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-dedup-"));
  });

  afterEach(async () => {
    await fs.rm(tmpGraph, { recursive: true, force: true });
  });

  test("empty graph → every candidate kept", async () => {
    const result = await dedupCandidatesAgainstGraph([cand()], [], tmpGraph);
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  test("non-existent graph directory → every candidate kept", async () => {
    const missing = path.join(tmpGraph, "does-not-exist");
    const result = await dedupCandidatesAgainstGraph([cand()], [], missing);
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  test("candidate with existing id is dropped", async () => {
    await writeNode(tmpGraph, {
      id: "token-economy",
      type: "concept",
      summary: "Minimize API calls",
      updated: "2026-04-21",
      confidence: 1,
    });

    const result = await dedupCandidatesAgainstGraph(
      [cand({ id: "token-economy" }), cand({ id: "new-concept" })],
      [],
      tmpGraph,
    );
    expect(result.kept.map((c) => c.id)).toEqual(["new-concept"]);
    expect(result.dropped.map((c) => c.id)).toEqual(["token-economy"]);
  });

  test("candidate matching an alias is dropped (not just id)", async () => {
    await writeNode(tmpGraph, {
      id: "litopys",
      type: "project",
      summary: "Graph memory",
      updated: "2026-04-21",
      confidence: 1,
      aliases: ["chronicle"],
    });

    const result = await dedupCandidatesAgainstGraph(
      [cand({ id: "chronicle", type: "project" })],
      [],
      tmpGraph,
    );
    expect(result.kept).toHaveLength(0);
    expect(result.dropped.map((c) => c.id)).toEqual(["chronicle"]);
  });

  test("case-insensitive match", async () => {
    await writeNode(tmpGraph, {
      id: "mcp",
      type: "system",
      summary: "Model Context Protocol",
      updated: "2026-04-21",
      confidence: 1,
    });
    const result = await dedupCandidatesAgainstGraph(
      [cand({ id: "MCP", type: "system" })],
      [],
      tmpGraph,
    );
    expect(result.dropped.map((c) => c.id)).toEqual(["MCP"]);
  });

  test("relations pass through unchanged even when endpoints reference existing nodes", async () => {
    await writeNode(tmpGraph, {
      id: "denis",
      type: "person",
      summary: "owner",
      updated: "2026-04-21",
      confidence: 1,
    });
    const relations = [rel({ sourceId: "denis", targetId: "new-concept", type: "prefers" })];
    const result = await dedupCandidatesAgainstGraph([cand()], relations, tmpGraph);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.sourceId).toBe("denis");
  });
});
