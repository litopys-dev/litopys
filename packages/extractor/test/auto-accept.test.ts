import { beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadGraph, writeNode } from "@litopys/core";
import type { AnyNode } from "@litopys/core";
import type { CandidateNode, CandidateRelation } from "../src/adapters/types.ts";
import { autoAcceptCandidates } from "../src/auto-accept.ts";
import { type QuarantineMeta, writeQuarantineTo } from "../src/quarantine.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function candidate(overrides: Partial<CandidateNode> = {}): CandidateNode {
  return {
    id: "new-concept",
    type: "concept",
    summary: "A brand new concept",
    confidence: 0.95,
    reasoning: "Stated explicitly by the user",
    sourceSessionId: "sess-001",
    ...overrides,
  };
}

function relation(overrides: Partial<CandidateRelation> = {}): CandidateRelation {
  return {
    type: "applies_to",
    sourceId: "new-concept",
    targetId: "existing-project",
    confidence: 0.9,
    reasoning: "Concept governs the project",
    sourceSessionId: "sess-001",
    ...overrides,
  };
}

function meta(overrides: Partial<QuarantineMeta> = {}): QuarantineMeta {
  return {
    sessionId: "sess-001",
    timestamp: "2026-07-26T10:00:00.000Z",
    adapterName: "openai",
    ...overrides,
  };
}

let tmp: string;
let graphDir: string;
let qDir: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-autoaccept-"));
  graphDir = path.join(tmp, "graph");
  qDir = path.join(tmp, "quarantine");
  await fs.mkdir(graphDir, { recursive: true });
  await fs.mkdir(qDir, { recursive: true });
});

async function seedNode(node: Partial<AnyNode> & { id: string; type: AnyNode["type"] }) {
  await writeNode(graphDir, {
    summary: `seeded ${node.id}`,
    updated: "2026-07-01",
    confidence: 1,
    ...node,
  } as AnyNode);
}

function run(overrides: Partial<Parameters<typeof autoAcceptCandidates>[0]> = {}) {
  return autoAcceptCandidates({
    quarantineDir: qDir,
    graphPath: graphDir,
    minConfidence: 0.9,
    dryRun: false,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Threshold behaviour
// ---------------------------------------------------------------------------

describe("autoAcceptCandidates — threshold", () => {
  test("accepts a candidate at or above the threshold and writes it to the graph", async () => {
    await writeQuarantineTo([candidate()], [], meta(), qDir);

    const result = await run();

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.candidateId).toBe("new-concept");
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.has("new-concept")).toBe(true);
  });

  test("boundary: confidence exactly equal to the threshold is accepted", async () => {
    await writeQuarantineTo([candidate({ confidence: 0.9 })], [], meta(), qDir);

    const result = await run({ minConfidence: 0.9 });

    expect(result.accepted).toHaveLength(1);
  });

  test("skips below-threshold candidates and leaves them in quarantine", async () => {
    await writeQuarantineTo([candidate({ confidence: 0.85 })], [], meta(), qDir);

    const result = await run();

    expect(result.accepted).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("below-threshold");
    expect(result.skipped[0]?.confidence).toBe(0.85);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.has("new-concept")).toBe(false);
    // File must survive so a human can still review the leftover candidate.
    expect((await fs.readdir(qDir)).filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });

  test("rejects an out-of-range threshold", async () => {
    await expect(run({ minConfidence: 1.5 })).rejects.toThrow(/minConfidence/);
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe("autoAcceptCandidates — guards", () => {
  test("skips a candidate whose id already exists in the graph", async () => {
    await seedNode({ id: "new-concept", type: "concept" });
    await writeQuarantineTo([candidate()], [], meta(), qDir);

    const result = await run();

    expect(result.accepted).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("already-in-graph");
  });

  test("skips a candidate matching an existing node's alias", async () => {
    await seedNode({
      id: "sonnet",
      type: "system",
      aliases: ["new-concept"],
    } as Partial<AnyNode> & {
      id: string;
      type: AnyNode["type"];
    });
    await writeQuarantineTo([candidate()], [], meta(), qDir);

    const result = await run();

    expect(result.skipped[0]?.reason).toBe("already-in-graph");
  });

  test("skips a near-duplicate of an existing node even under a different id", async () => {
    await seedNode({ id: "sonnet", type: "concept", tags: ["llm", "model"] } as Partial<AnyNode> & {
      id: string;
      type: AnyNode["type"];
    });
    await writeQuarantineTo(
      [candidate({ id: "sonnet-5", type: "concept", tags: ["llm", "model"] })],
      [],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.accepted).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("near-duplicate");
  });

  test("lands one id only once per pass, even from two different files", async () => {
    // Two sessions proposing the same id under different types. Both landing
    // means two files under one id — a collision the loader cannot resolve.
    await writeQuarantineTo(
      [candidate({ id: "sonnet-5", type: "system" })],
      [],
      meta({ timestamp: "2026-07-01T10:00:00.000Z", sessionId: "sess-a" }),
      qDir,
    );
    await writeQuarantineTo(
      [candidate({ id: "sonnet-5", type: "concept" })],
      [],
      meta({ timestamp: "2026-07-02T10:00:00.000Z", sessionId: "sess-b" }),
      qDir,
    );

    const result = await run();

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.type).toBe("system");
    // Which guard fires depends on ordering: across files the graph reload sees
    // the landed node first; the batch guard is what makes dry-run agree.
    expect(["duplicate-in-batch", "already-in-graph"]).toContain(
      result.skipped[0]?.reason ?? "(none)",
    );
  });

  test("dry-run reports the same single acceptance for a repeated id", async () => {
    await writeQuarantineTo(
      [candidate({ id: "sonnet-5", type: "system" })],
      [],
      meta({ timestamp: "2026-07-01T10:00:00.000Z", sessionId: "sess-a" }),
      qDir,
    );
    await writeQuarantineTo(
      [candidate({ id: "sonnet-5", type: "concept" })],
      [],
      meta({ timestamp: "2026-07-02T10:00:00.000Z", sessionId: "sess-b" }),
      qDir,
    );

    const result = await run({ dryRun: true });

    expect(result.accepted).toHaveLength(1);
  });

  test("two candidates sharing an id inside one file cannot both land", async () => {
    await writeQuarantineTo(
      [candidate({ id: "twin", type: "system" }), candidate({ id: "twin", type: "concept" })],
      [],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.accepted).toHaveLength(1);
    expect(result.skipped.map((s) => s.reason)).toContain("duplicate-in-batch");
  });

  test("skips a candidate that admits it was inferred rather than stated", async () => {
    await writeQuarantineTo(
      [
        candidate({
          id: "ghost-person",
          type: "person",
          body: "A roommate, not explicitly mentioned but inferred through context",
        }),
      ],
      [],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.accepted).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("speculative");
  });

  test("speculation guard also inspects the reasoning field", async () => {
    await writeQuarantineTo(
      [candidate({ reasoning: "Не упоминается прямо, выведено из контекста" })],
      [],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.skipped[0]?.reason).toBe("speculative");
  });

  test("guardSpeculation:false lets an inferred candidate through", async () => {
    await writeQuarantineTo(
      [candidate({ body: "not explicitly mentioned but inferred through context" })],
      [],
      meta(),
      qDir,
    );

    const result = await run({ guardSpeculation: false });

    expect(result.accepted).toHaveLength(1);
  });

  test("skips a schema-invalid candidate instead of throwing", async () => {
    // Uppercase id violates the kebab-case rule enforced by CandidateNodeSchema.
    await writeQuarantineTo(
      [candidate({ id: "Not Kebab Case" } as Partial<CandidateNode>)],
      [],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.accepted).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("invalid-schema");
  });
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

describe("autoAcceptCandidates — relations", () => {
  test("applies a relation from an accepted candidate to an existing node", async () => {
    await seedNode({ id: "existing-project", type: "project" });
    await writeQuarantineTo([candidate()], [relation()], meta(), qDir);

    const result = await run();

    expect(result.accepted[0]?.relationsApplied).toBe(1);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.get("new-concept")?.rels?.applies_to).toContain("existing-project");
  });

  test("applies a relation between two candidates regardless of promotion order", async () => {
    // The relation points from the SECOND candidate to the FIRST, so a naive
    // one-pass promotion would drop it (target not yet in the graph).
    await writeQuarantineTo(
      [
        candidate({ id: "concept-a", type: "concept" }),
        candidate({ id: "lesson-b", type: "lesson" }),
      ],
      [relation({ type: "applies_to", sourceId: "lesson-b", targetId: "concept-a" })],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.accepted).toHaveLength(2);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.get("lesson-b")?.rels?.applies_to).toContain("concept-a");
  });

  test("never auto-applies supersedes — bi-temporal side effects need a human", async () => {
    await seedNode({ id: "old-concept", type: "concept" });
    await writeQuarantineTo(
      [candidate()],
      [relation({ type: "supersedes", sourceId: "new-concept", targetId: "old-concept" })],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.accepted).toHaveLength(1);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.get("new-concept")?.rels?.supersedes).toBeUndefined();
    expect(result.relationsDeferred).toBe(1);
  });

  test("drops a relation that violates the type constraint table", async () => {
    // owns requires source=person; a concept may not own anything.
    await seedNode({ id: "existing-project", type: "project" });
    await writeQuarantineTo(
      [candidate()],
      [relation({ type: "owns", sourceId: "new-concept", targetId: "existing-project" })],
      meta(),
      qDir,
    );

    const result = await run();

    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.get("new-concept")?.rels?.owns).toBeUndefined();
    expect(result.relationsInvalid).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Pruning unactionable entries
// ---------------------------------------------------------------------------

describe("autoAcceptCandidates — pruning", () => {
  test("rejects an already-created candidate and logs it to rejected.jsonl", async () => {
    await seedNode({ id: "new-concept", type: "concept" });
    await writeQuarantineTo([candidate()], [], meta(), qDir);

    const result = await run();

    expect(result.pruned).toBe(1);
    expect((await fs.readdir(qDir)).filter((f) => f.endsWith(".md"))).toHaveLength(0);
    const log = await fs.readFile(path.join(qDir, "rejected.jsonl"), "utf-8");
    expect(log).toContain("new-concept");
    expect(log).toContain("already exists in the graph");
  });

  test("pruneUnactionable:false keeps the already-created candidate queued", async () => {
    await seedNode({ id: "new-concept", type: "concept" });
    await writeQuarantineTo([candidate()], [], meta(), qDir);

    const result = await run({ pruneUnactionable: false });

    expect(result.pruned).toBe(0);
    expect((await fs.readdir(qDir)).filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });

  test("drops a relation whose endpoints exist nowhere and are not queued", async () => {
    await writeQuarantineTo(
      [],
      [relation({ sourceId: "ghost-a", targetId: "ghost-b" })],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.relationsDangling).toBe(1);
    expect(result.filesRemoved).toBe(1);
  });

  test("keeps a relation whose missing endpoint is still a queued candidate", async () => {
    // The candidate is below threshold, so it stays; the edge may become
    // applicable once a human promotes it.
    await seedNode({ id: "existing-project", type: "project" });
    await writeQuarantineTo(
      [candidate({ confidence: 0.5 })],
      [relation({ sourceId: "new-concept", targetId: "existing-project" })],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.relationsDangling).toBe(0);
    expect(result.relationsDeferred).toBe(1);
    expect((await fs.readdir(qDir)).filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });

  test("applies a high-confidence edge between two nodes that already existed", async () => {
    await seedNode({ id: "lesson-x", type: "lesson" });
    await seedNode({ id: "project-y", type: "project" });
    await writeQuarantineTo(
      [],
      [relation({ type: "applies_to", sourceId: "lesson-x", targetId: "project-y" })],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.relationsApplied).toBe(1);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.get("lesson-x")?.rels?.applies_to).toContain("project-y");
  });

  test("keeps a low-confidence but structurally valid edge for review", async () => {
    await seedNode({ id: "lesson-x", type: "lesson" });
    await seedNode({ id: "project-y", type: "project" });
    await writeQuarantineTo(
      [],
      [
        relation({
          type: "applies_to",
          sourceId: "lesson-x",
          targetId: "project-y",
          confidence: 0.6,
        }),
      ],
      meta(),
      qDir,
    );

    const result = await run();

    expect(result.relationsApplied).toBe(0);
    expect(result.relationsDeferred).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// File lifecycle
// ---------------------------------------------------------------------------

describe("autoAcceptCandidates — file lifecycle", () => {
  test("removes the quarantine file once nothing is left to review", async () => {
    await seedNode({ id: "existing-project", type: "project" });
    await writeQuarantineTo([candidate()], [relation()], meta(), qDir);

    const result = await run();

    expect(result.filesRemoved).toBe(1);
    expect((await fs.readdir(qDir)).filter((f) => f.endsWith(".md"))).toHaveLength(0);
  });

  test("keeps the file when a deferred relation still needs review", async () => {
    await seedNode({ id: "old-concept", type: "concept" });
    await writeQuarantineTo(
      [candidate()],
      [relation({ type: "supersedes", sourceId: "new-concept", targetId: "old-concept" })],
      meta(),
      qDir,
    );

    await run();

    const left = (await fs.readdir(qDir)).filter((f) => f.endsWith(".md"));
    expect(left).toHaveLength(1);
    const content = await fs.readFile(path.join(qDir, left[0] as string), "utf-8");
    expect(content).toContain("supersedes");
    // The promoted candidate itself is gone; only the deferred relation remains.
    expect(content).not.toContain("A brand new concept");
  });

  test("ignores merge-proposal files living in the same directory", async () => {
    await fs.writeFile(
      path.join(qDir, "merge-proposal-x.md"),
      '---\nkind: "merge-proposal"\ndetectedBy: "similar:0.9"\n---\n\n# Merge Proposal\n',
      "utf-8",
    );

    const result = await run();

    expect(result.filesScanned).toBe(0);
    expect(result.accepted).toHaveLength(0);
  });

  test("missing quarantine directory yields an empty result", async () => {
    const result = await run({ quarantineDir: path.join(tmp, "nope") });

    expect(result.filesScanned).toBe(0);
    expect(result.accepted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

describe("autoAcceptCandidates — dryRun", () => {
  test("reports the plan without touching the graph or the quarantine file", async () => {
    await seedNode({ id: "existing-project", type: "project" });
    await writeQuarantineTo([candidate()], [relation()], meta(), qDir);

    const result = await run({ dryRun: true });

    expect(result.accepted).toHaveLength(1);
    expect(result.filesRemoved).toBe(0);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.has("new-concept")).toBe(false);
    expect((await fs.readdir(qDir)).filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });
});
