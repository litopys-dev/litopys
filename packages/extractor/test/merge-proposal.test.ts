import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AnyNode } from "@litopys/core";
import {
  acceptMergeProposal,
  isMergeProposalContent,
  parseMergeProposal,
  proposeMerge,
  rejectMergeProposal,
  serializeMergeProposal,
  writeMergeProposal,
} from "../src/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkNode(partial: Partial<AnyNode> & Pick<AnyNode, "id" | "type">): AnyNode {
  return { updated: "2026-04-21", confidence: 1, ...partial } as AnyNode;
}

async function mkGraph(nodes: AnyNode[]): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-merge-"));
  for (const n of nodes) {
    const typeDir: Record<string, string> = {
      person: "people",
      project: "projects",
      system: "systems",
      concept: "concepts",
      event: "events",
      lesson: "lessons",
    };
    const dir = path.join(tmp, typeDir[n.type] ?? "unknown");
    await fs.mkdir(dir, { recursive: true });
    const { body, ...fm } = n;
    const lines = ["---"];
    for (const [k, v] of Object.entries(fm)) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
    lines.push("---");
    lines.push("");
    if (body) lines.push(body);
    await fs.writeFile(path.join(dir, `${n.id}.md`), lines.join("\n"), "utf-8");
  }
  return tmp;
}

// ---------------------------------------------------------------------------
// proposeMerge
// ---------------------------------------------------------------------------

describe("proposeMerge", () => {
  test("higher confidence wins", () => {
    const a = mkNode({ id: "a-id", type: "system", confidence: 0.9 });
    const b = mkNode({ id: "b-id", type: "system", confidence: 0.7 });
    const p = proposeMerge(a, b);
    expect(p.result.winnerId).toBe("a-id");
    expect(p.result.loserId).toBe("b-id");
  });

  test("confidence tie → newer updated wins", () => {
    const a = mkNode({ id: "a-id", type: "system", updated: "2026-01-01" });
    const b = mkNode({ id: "b-id", type: "system", updated: "2026-04-21" });
    const p = proposeMerge(a, b);
    expect(p.result.winnerId).toBe("b-id");
  });

  test("aliases merged, loser id promoted to alias", () => {
    const a = mkNode({ id: "thinkpad-x240", type: "system", confidence: 0.9, aliases: ["x240"] });
    const b = mkNode({ id: "lenovo-x240", type: "system", confidence: 0.7, aliases: ["lenovo"] });
    const p = proposeMerge(a, b);
    expect(p.result.aliases).toContain("x240");
    expect(p.result.aliases).toContain("lenovo");
    expect(p.result.aliases).toContain("lenovo-x240");
    expect(p.result.aliases).not.toContain("thinkpad-x240"); // winner's own id excluded
  });

  test("tags merged (union)", () => {
    const a = mkNode({ id: "a-id", type: "system", tags: ["laptop", "work"] });
    const b = mkNode({ id: "b-id", type: "system", tags: ["laptop", "personal"] });
    const p = proposeMerge(a, b);
    expect(p.result.tags).toContain("laptop");
    expect(p.result.tags).toContain("work");
    expect(p.result.tags).toContain("personal");
    expect(p.result.tags).toHaveLength(3);
  });

  test("rels merged and supersedes relation added", () => {
    const a = mkNode({
      id: "a-id",
      type: "system",
      confidence: 0.9,
      rels: { depends_on: ["x"] },
    });
    const b = mkNode({
      id: "b-id",
      type: "system",
      confidence: 0.7,
      rels: { depends_on: ["y"], uses: ["z"] },
    });
    const p = proposeMerge(a, b);
    expect(p.result.rels.depends_on).toContain("x");
    expect(p.result.rels.depends_on).toContain("y");
    expect(p.result.rels.uses).toContain("z");
    expect(p.result.rels.supersedes).toContain("b-id");
  });

  test("divergent summary produces conflict", () => {
    const a = mkNode({ id: "a-id", type: "system", summary: "foo", confidence: 0.9 });
    const b = mkNode({ id: "b-id", type: "system", summary: "bar", confidence: 0.7 });
    const p = proposeMerge(a, b);
    const summaryConflict = p.conflicts.find((c) => c.field === "summary");
    expect(summaryConflict).toBeDefined();
    expect(p.result.summary).toBe("foo");
  });

  test("type conflict flagged", () => {
    const a = mkNode({ id: "a-id", type: "system" });
    const b = mkNode({ id: "b-id", type: "concept" });
    const p = proposeMerge(a, b);
    const typeConflict = p.conflicts.find((c) => c.field === "type");
    expect(typeConflict).toBeDefined();
  });

  test("direct relation between A and B flagged as conflict", () => {
    const a = mkNode({
      id: "a-id",
      type: "system",
      confidence: 0.9,
      rels: { depends_on: ["b-id"] },
    });
    const b = mkNode({ id: "b-id", type: "system", confidence: 0.7 });
    const p = proposeMerge(a, b);
    const relConflict = p.conflicts.find((c) => c.field === "rels");
    expect(relConflict).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Serialize / parse roundtrip
// ---------------------------------------------------------------------------

describe("serialize / parse merge proposal", () => {
  test("roundtrip preserves data", () => {
    const a = mkNode({ id: "x", type: "concept", confidence: 0.9, tags: ["t"] });
    const b = mkNode({ id: "y", type: "concept", confidence: 0.7 });
    const p = proposeMerge(a, b, { detectedBy: "similar:0.82" });
    const serialized = serializeMergeProposal(p, "2026-04-21T10:00:00.000Z");

    expect(isMergeProposalContent(serialized)).toBe(true);
    const parsed = parseMergeProposal(serialized);
    expect(parsed.sourceA).toBe("x");
    expect(parsed.sourceB).toBe("y");
    expect(parsed.detectedBy).toBe("similar:0.82");
    expect(parsed.result.winnerId).toBe("x");
  });

  test("isMergeProposalContent rejects regular candidate files", () => {
    const notAProposal = `---\nsessionId: "abc"\ntimestamp: "2026-04-21T00:00:00Z"\n---\n\n\`\`\`json\n{"candidates":[]}\n\`\`\`\n`;
    expect(isMergeProposalContent(notAProposal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// writeMergeProposal round-trip
// ---------------------------------------------------------------------------

describe("writeMergeProposal", () => {
  test("writes file that can be read back", async () => {
    const a = mkNode({ id: "x", type: "concept" });
    const b = mkNode({ id: "y", type: "concept" });
    const p = proposeMerge(a, b);
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-mp-"));
    try {
      const filePath = await writeMergeProposal(p, tmp);
      expect(filePath.startsWith(tmp)).toBe(true);
      const content = await fs.readFile(filePath, "utf-8");
      expect(isMergeProposalContent(content)).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// acceptMergeProposal / rejectMergeProposal
// ---------------------------------------------------------------------------

describe("acceptMergeProposal", () => {
  test("writes merged node and tombstones loser", async () => {
    const a = mkNode({
      id: "winner",
      type: "system",
      confidence: 0.9,
      summary: "the winner",
      tags: ["t1"],
    });
    const b = mkNode({
      id: "loser",
      type: "system",
      confidence: 0.7,
      summary: "the loser",
      tags: ["t2"],
    });
    const graphDir = await mkGraph([a, b]);

    try {
      const proposal = proposeMerge(a, b);
      const qDir = path.join(graphDir, "..", "quarantine");
      const filePath = await writeMergeProposal(proposal, qDir);

      const result = await acceptMergeProposal(filePath, graphDir);
      expect(result.winnerId).toBe("winner");
      expect(result.loserId).toBe("loser");

      // Winner file should contain supersedes relation
      const winnerContent = await fs.readFile(path.join(graphDir, "systems", "winner.md"), "utf-8");
      expect(winnerContent).toContain("supersedes");
      expect(winnerContent).toContain("loser");

      // Loser file should have `until` set
      const loserContent = await fs.readFile(path.join(graphDir, "systems", "loser.md"), "utf-8");
      expect(loserContent).toMatch(/until:\s*['"]?\d{4}-\d{2}-\d{2}/);

      // Proposal file should be archived (not still at original path)
      const stillExists = await fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false);
      expect(stillExists).toBe(false);
    } finally {
      await fs.rm(graphDir, { recursive: true, force: true });
    }
  });

  test("refuses to apply with type conflict", async () => {
    const a = mkNode({ id: "x", type: "system" });
    const b = mkNode({ id: "y", type: "concept" });
    const graphDir = await mkGraph([a, b]);
    try {
      const p = proposeMerge(a, b);
      const qDir = path.join(graphDir, "..", "quarantine");
      const filePath = await writeMergeProposal(p, qDir);
      await expect(acceptMergeProposal(filePath, graphDir)).rejects.toThrow(/type conflict/);
    } finally {
      await fs.rm(graphDir, { recursive: true, force: true });
    }
  });
});

describe("rejectMergeProposal", () => {
  test("archives the file without mutating the graph", async () => {
    const a = mkNode({ id: "x", type: "concept" });
    const b = mkNode({ id: "y", type: "concept" });
    const graphDir = await mkGraph([a, b]);
    try {
      const p = proposeMerge(a, b);
      const qDir = path.join(graphDir, "..", "quarantine");
      const filePath = await writeMergeProposal(p, qDir);
      await rejectMergeProposal(filePath);

      const origExists = await fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false);
      expect(origExists).toBe(false);

      // Loser file should NOT have until (graph untouched)
      const loserContent = await fs.readFile(path.join(graphDir, "concepts", "y.md"), "utf-8");
      expect(loserContent).not.toContain("until:");
    } finally {
      await fs.rm(graphDir, { recursive: true, force: true });
    }
  });
});
