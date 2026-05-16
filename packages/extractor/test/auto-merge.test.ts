import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type AnyNode, loadGraph, writeNode } from "@litopys/core";
import {
  autoMergeProposals,
  parseSimilarity,
  proposeMerge,
  writeMergeProposal,
} from "../src/index.ts";

function mkNode(partial: Partial<AnyNode> & Pick<AnyNode, "id" | "type">): AnyNode {
  return { updated: "2026-04-21", confidence: 1, ...partial } as AnyNode;
}

describe("parseSimilarity", () => {
  test("parses similar:0.873", () => {
    expect(parseSimilarity("similar:0.873")).toBe(0.873);
  });

  test("parses similar:1", () => {
    expect(parseSimilarity("similar:1")).toBe(1);
  });

  test("parses similar:.5", () => {
    expect(parseSimilarity("similar:.5")).toBe(0.5);
  });

  test("returns undefined for manual", () => {
    expect(parseSimilarity("manual")).toBeUndefined();
  });

  test("returns undefined for unrelated provenance", () => {
    expect(parseSimilarity("dedup:0.9")).toBeUndefined();
  });

  test("returns undefined for out-of-range score", () => {
    expect(parseSimilarity("similar:1.5")).toBeUndefined();
  });

  test("returns undefined for non-numeric tail", () => {
    expect(parseSimilarity("similar:high")).toBeUndefined();
  });
});

describe("autoMergeProposals", () => {
  let tmpDir: string;
  let graphDir: string;
  let qDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-automerge-"));
    graphDir = path.join(tmpDir, "graph");
    qDir = path.join(tmpDir, "quarantine");
    await fs.mkdir(graphDir, { recursive: true });
    await fs.mkdir(qDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function seedPair(
    aId: string,
    bId: string,
    similarity: number,
    overrides: { aConfidence?: number; bConfidence?: number } = {},
  ): Promise<string> {
    const a = mkNode({
      id: aId,
      type: "system",
      confidence: overrides.aConfidence ?? 0.9,
      summary: "node a",
      body: "",
    });
    const b = mkNode({
      id: bId,
      type: "system",
      confidence: overrides.bConfidence ?? 0.7,
      summary: "node b",
      body: "",
    });
    await writeNode(graphDir, a);
    await writeNode(graphDir, b);
    const proposal = proposeMerge(a, b, { detectedBy: `similar:${similarity.toFixed(3)}` });
    return writeMergeProposal(proposal, qDir);
  }

  test("empty quarantine dir yields empty result", async () => {
    const result = await autoMergeProposals({
      quarantineDir: path.join(tmpDir, "does-not-exist"),
      graphPath: graphDir,
      minSimilarity: 0.95,
      dryRun: false,
    });
    expect(result.merged).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.scanned).toBe(0);
  });

  test("accepts a proposal at exactly threshold", async () => {
    await seedPair("apple-a", "apple-b", 0.95);

    const result = await autoMergeProposals({
      quarantineDir: qDir,
      graphPath: graphDir,
      minSimilarity: 0.95,
      dryRun: false,
    });

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.winnerId).toBe("apple-a");
    expect(result.merged[0]?.loserId).toBe("apple-b");
    expect(result.merged[0]?.similarity).toBe(0.95);
    expect(result.scanned).toBe(1);

    // Loser is tombstoned in the graph.
    const reloaded = await loadGraph(graphDir);
    expect(reloaded.nodes.get("apple-b")?.until).toBeDefined();
  });

  test("skips a proposal below threshold (default 0.95)", async () => {
    const filePath = await seedPair("low-a", "low-b", 0.8);

    const result = await autoMergeProposals({
      quarantineDir: qDir,
      graphPath: graphDir,
      minSimilarity: 0.95,
      dryRun: false,
    });

    expect(result.merged).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe("below-threshold");
    expect(result.skipped[0]?.similarity).toBe(0.8);
    expect(result.scanned).toBe(1);

    // Proposal file untouched.
    const stillThere = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(true);
  });

  test("dry-run reports plan but does not mutate graph or quarantine", async () => {
    const filePath = await seedPair("dry-a", "dry-b", 0.97);

    const result = await autoMergeProposals({
      quarantineDir: qDir,
      graphPath: graphDir,
      minSimilarity: 0.95,
      dryRun: true,
    });

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.winnerId).toBe("dry-a");

    // Proposal still in quarantine.
    const stillThere = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(true);

    // Loser NOT tombstoned.
    const reloaded = await loadGraph(graphDir);
    expect(reloaded.nodes.get("dry-b")?.until).toBeUndefined();
  });

  test("skips proposals with manual detectedBy (no similar:X)", async () => {
    const a = mkNode({ id: "man-a", type: "system", confidence: 0.9, body: "" });
    const b = mkNode({ id: "man-b", type: "system", confidence: 0.7, body: "" });
    await writeNode(graphDir, a);
    await writeNode(graphDir, b);
    const proposal = proposeMerge(a, b, { detectedBy: "manual" });
    await writeMergeProposal(proposal, qDir);

    const result = await autoMergeProposals({
      quarantineDir: qDir,
      graphPath: graphDir,
      minSimilarity: 0.95,
      dryRun: false,
    });
    expect(result.merged).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe("missing-similarity");
  });

  test("ignores non-merge-proposal quarantine files", async () => {
    // A regular candidate file shape — frontmatter without merge-proposal kind.
    const otherPath = path.join(qDir, "2026-04-22-something.md");
    await fs.writeFile(
      otherPath,
      `---
sessionId: "abc"
timestamp: "2026-04-22T00:00:00Z"
adapterName: "text"
---

# Quarantine Candidates

\`\`\`json
{"candidates":[],"relations":[]}
\`\`\`
`,
      "utf-8",
    );

    await seedPair("ok-a", "ok-b", 0.99);

    const result = await autoMergeProposals({
      quarantineDir: qDir,
      graphPath: graphDir,
      minSimilarity: 0.95,
      dryRun: false,
    });
    // Only the merge proposal counts toward scanned.
    expect(result.scanned).toBe(1);
    expect(result.merged).toHaveLength(1);
  });

  test("captures per-file errors without aborting the run", async () => {
    // Proposal with both nodes present, similarity high -> normally merges.
    await seedPair("good-a", "good-b", 0.98);

    // Second proposal: refer to nodes that we delete before running.
    const a = mkNode({ id: "ghost-a", type: "system", confidence: 0.9, body: "" });
    const b = mkNode({ id: "ghost-b", type: "system", confidence: 0.7, body: "" });
    await writeNode(graphDir, a);
    await writeNode(graphDir, b);
    const ghostProposal = proposeMerge(a, b, { detectedBy: "similar:0.99" });
    const ghostPath = await writeMergeProposal(ghostProposal, qDir);
    // Remove the loser file from the graph entirely to force acceptMergeProposal
    // to throw with "Loser node ... no longer in graph".
    await fs.unlink(path.join(graphDir, "systems", "ghost-b.md"));

    const result = await autoMergeProposals({
      quarantineDir: qDir,
      graphPath: graphDir,
      minSimilarity: 0.95,
      dryRun: false,
    });
    expect(result.merged.length).toBe(1);
    expect(result.merged[0]?.winnerId).toBe("good-a");
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.proposalPath).toBe(ghostPath);
    expect(result.errors[0]?.message).toMatch(/ghost-b/);
  });

  test("rejects invalid minSimilarity", async () => {
    await expect(
      autoMergeProposals({
        quarantineDir: qDir,
        graphPath: graphDir,
        minSimilarity: 1.5,
        dryRun: true,
      }),
    ).rejects.toThrow(/minSimilarity/);
  });
});
