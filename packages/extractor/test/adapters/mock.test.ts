import { describe, expect, test } from "bun:test";
import {
  MockAdapter,
  extractCandidateNodes,
  extractCandidateRelations,
  toKebabId,
} from "../../src/adapters/mock.ts";
import { AdapterCompleteError } from "../../src/adapters/types.ts";

describe("toKebabId", () => {
  test("lowercases and replaces whitespace", () => {
    expect(toKebabId("Alice Chen")).toBe("alice-chen");
  });

  test("strips diacritics", () => {
    expect(toKebabId("Café Crème")).toBe("cafe-creme");
  });

  test("collapses multiple separators", () => {
    expect(toKebabId("  foo__bar   baz  ")).toBe("foo-bar-baz");
  });

  test("drops illegal characters", () => {
    expect(toKebabId("hello@world!")).toBe("helloworld");
  });
});

describe("extractCandidateNodes", () => {
  test("extracts person with auto-derived id and alias", () => {
    const nodes = extractCandidateNodes("Person: Alice Chen, lead engineer", "sess");
    expect(nodes).toHaveLength(1);
    const n = nodes[0];
    expect(n).toBeDefined();
    if (!n) return;
    expect(n.id).toBe("alice-chen");
    expect(n.type).toBe("person");
    expect(n.aliases).toEqual(["Alice Chen"]);
    expect(n.body).toBe("lead engineer");
    expect(n.sourceSessionId).toBe("sess");
  });

  test("extracts each declared type", () => {
    const transcript = [
      "Person: Bob Lee, designer",
      "Project: foo-bar, the redesign",
      "System: web-api, http edge",
      "Concept: backpressure, flow-control idea",
      "Lesson: log-everything, hindsight",
      "Event: 2024-01-01-launch, day-one",
    ].join("\n");
    const nodes = extractCandidateNodes(transcript, "s");
    expect(nodes.map((n) => n.type).sort()).toEqual([
      "concept",
      "event",
      "lesson",
      "person",
      "project",
      "system",
    ]);
  });

  test("dedupes repeated declarations within one transcript", () => {
    const transcript = "Project: foo, first\nProject: foo, second";
    const nodes = extractCandidateNodes(transcript, "s");
    expect(nodes).toHaveLength(1);
  });

  test("returns empty list when no patterns match", () => {
    expect(extractCandidateNodes("just some prose", "s")).toEqual([]);
  });

  test("description is optional", () => {
    const nodes = extractCandidateNodes("Concept: ablation", "s");
    const n = nodes[0];
    expect(n).toBeDefined();
    if (!n) return;
    expect(n.id).toBe("ablation");
    expect(n.body).toBeUndefined();
    expect(n.summary).toBe("ablation");
  });
});

describe("extractCandidateRelations", () => {
  test("extracts 'owns' between known kebab ids", () => {
    const known = new Set(["alice-chen", "pegasus-api"]);
    const rels = extractCandidateRelations("alice-chen owns pegasus-api today", known, "s");
    expect(rels).toHaveLength(1);
    const r = rels[0];
    expect(r).toBeDefined();
    if (!r) return;
    expect(r.type).toBe("owns");
    expect(r.sourceId).toBe("alice-chen");
    expect(r.targetId).toBe("pegasus-api");
  });

  test("ignores relations where either endpoint is unknown", () => {
    const known = new Set(["alice-chen"]);
    expect(extractCandidateRelations("alice-chen owns pegasus-api", known, "s")).toEqual([]);
  });

  test("dedupes identical relation tuples", () => {
    const known = new Set(["a-one", "b-two"]);
    const rels = extractCandidateRelations("a-one owns b-two. a-one owns b-two.", known, "s");
    expect(rels).toHaveLength(1);
  });
});

describe("MockAdapter", () => {
  test("name and model defaults", () => {
    const a = new MockAdapter();
    expect(a.name).toBe("mock");
    expect(a.model).toBe("mock-v1");
  });

  test("failWith option makes complete() throw AdapterCompleteError", async () => {
    const adapter = new MockAdapter({ failWith: new Error("rate limited") });
    await expect(adapter.complete({ prompt: "test" })).rejects.toBeInstanceOf(AdapterCompleteError);
  });

  test("failWith: completeCalls increments even on throw", async () => {
    const adapter = new MockAdapter({ failWith: new Error("boom") });
    try {
      await adapter.complete({ prompt: "test" });
    } catch {
      // expected
    }
    expect(adapter.completeCalls).toBe(1);
  });

  test("failWith: message from original error is preserved in AdapterCompleteError", async () => {
    const adapter = new MockAdapter({ failWith: new Error("HTTP 429 Too Many Requests") });
    let caught: unknown;
    try {
      await adapter.complete({ prompt: "test" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdapterCompleteError);
    expect(String(caught)).toContain("HTTP 429 Too Many Requests");
  });

  test("custom model label", () => {
    expect(new MockAdapter({ model: "mock-v2" }).model).toBe("mock-v2");
  });

  test("extract returns deterministic output and respects existingNodeIds", async () => {
    const adapter = new MockAdapter();
    const out = await adapter.extract({
      transcript: "Person: Carol, lead\nSystem: redis-cache, in-memory",
      existingNodeIds: ["carol"],
    });
    expect(out.candidateNodes.map((n) => n.id)).toEqual(["redis-cache"]);
    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(out.modelUsed).toBe("mock-v1");
  });

  test("respects maxCandidates cap", async () => {
    const transcript = ["Project: a", "Project: b", "Project: c"].join("\n");
    const out = await new MockAdapter().extract({
      transcript,
      existingNodeIds: [],
      maxCandidates: 2,
    });
    expect(out.candidateNodes).toHaveLength(2);
  });
});
