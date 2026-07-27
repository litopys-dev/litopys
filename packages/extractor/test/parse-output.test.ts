import { describe, expect, test } from "bun:test";
import {
  normalizeEnums,
  normalizeNodeType,
  normalizeRelationName,
  parseExtractorOutput,
} from "../src/adapters/parse-output.ts";

function parse(payload: unknown, raw?: string) {
  return parseExtractorOutput({
    rawText: raw ?? JSON.stringify(payload),
    modelUsed: "test-model",
    sessionId: "sess-1",
    inputTokens: 10,
    outputTokens: 20,
    providerLabel: "Test",
  });
}

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: "a-node",
    type: "concept",
    summary: "Something durable",
    confidence: 0.9,
    reasoning: "Stated by the user",
    sourceSessionId: "sess-1",
    ...overrides,
  };
}

function rel(overrides: Record<string, unknown> = {}) {
  return {
    type: "applies_to",
    sourceId: "a-node",
    targetId: "b-node",
    confidence: 0.9,
    reasoning: "Because",
    sourceSessionId: "sess-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Enum snapping
// ---------------------------------------------------------------------------

describe("normalizeRelationName", () => {
  test("passes canonical names through", () => {
    expect(normalizeRelationName("learned_from")).toBe("learned_from");
  });

  test("fixes the near-miss the provider actually emits", () => {
    expect(normalizeRelationName("learns_from")).toBe("learned_from");
  });

  test("accepts hyphens and case", () => {
    expect(normalizeRelationName("Applies-To")).toBe("applies_to");
  });

  test("maps short forms", () => {
    expect(normalizeRelationName("depends")).toBe("depends_on");
    expect(normalizeRelationName("runs")).toBe("runs_on");
  });

  test("refuses to flip an inverse relation", () => {
    // owned_by names the same edge backwards; mapping it to owns would assert
    // something the model never said.
    expect(normalizeRelationName("owned_by")).toBeUndefined();
  });

  test("gives up on nonsense rather than guessing", () => {
    expect(normalizeRelationName("frobnicates")).toBeUndefined();
    expect(normalizeRelationName(42)).toBeUndefined();
  });
});

describe("normalizeNodeType", () => {
  test("maps the observed synonyms", () => {
    expect(normalizeNodeType("service")).toBe("system");
    expect(normalizeNodeType("application")).toBe("project");
    expect(normalizeNodeType("insight")).toBe("lesson");
  });

  test("fixes simple typos", () => {
    expect(normalizeNodeType("systm")).toBe("system");
    expect(normalizeNodeType("Concept")).toBe("concept");
  });

  test("leaves a relation object's type alone", () => {
    // The model sometimes drops a relation into candidateNodes; there is no
    // node type to snap it to, so it must be dropped by validation.
    expect(normalizeNodeType("relation")).toBeUndefined();
  });
});

describe("normalizeEnums", () => {
  test("rewrites types in place without touching other fields", () => {
    const out = normalizeEnums({
      candidateNodes: [node({ type: "service" })],
      candidateRelations: [rel({ type: "learns_from" })],
    }) as Record<string, Array<Record<string, unknown>>>;

    expect(out.candidateNodes?.[0]?.type).toBe("system");
    expect(out.candidateNodes?.[0]?.summary).toBe("Something durable");
    expect(out.candidateRelations?.[0]?.type).toBe("learned_from");
  });

  test("survives non-object input", () => {
    expect(normalizeEnums(null)).toBeNull();
    expect(normalizeEnums("nope")).toBe("nope");
  });
});

// ---------------------------------------------------------------------------
// Per-item validation
// ---------------------------------------------------------------------------

describe("parseExtractorOutput", () => {
  test("keeps valid items and drops only the malformed one", () => {
    const out = parse({
      candidateNodes: [node({ id: "keep-me" }), node({ id: "NOT KEBAB" })],
      candidateRelations: [rel(), rel({ type: "frobnicates" })],
    });

    expect(out.candidateNodes.map((n) => n.id)).toEqual(["keep-me"]);
    expect(out.candidateRelations).toHaveLength(1);
    expect(out.failure).toBeUndefined();
  });

  test("the whole batch used to die on one bad enum — now it survives", () => {
    const out = parse({
      candidateNodes: [node({ id: "first" }), node({ id: "second" })],
      candidateRelations: [rel({ type: "learns_from" }), rel({ type: "owned_by" })],
    });

    expect(out.candidateNodes).toHaveLength(2);
    // learns_from was normalized and kept; owned_by was dropped, not flipped.
    expect(out.candidateRelations).toHaveLength(1);
    expect(out.candidateRelations[0]?.type).toBe("learned_from");
  });

  test("a genuinely empty extraction is not a failure", () => {
    const out = parse({ candidateNodes: [], candidateRelations: [] });

    expect(out.failure).toBeUndefined();
    expect(out.candidateNodes).toHaveLength(0);
  });

  test("non-JSON output is reported as unparseable", () => {
    const out = parse(undefined, "I'm afraid I can't do that.");

    expect(out.failure?.kind).toBe("unparseable");
    expect(out.candidateNodes).toHaveLength(0);
  });

  test("items present but all invalid is unparseable, not empty", () => {
    const out = parse({
      candidateNodes: [node({ id: "BAD ID" })],
      candidateRelations: [],
    });

    expect(out.failure?.kind).toBe("unparseable");
  });

  test("strips markdown fences around the JSON", () => {
    const payload = JSON.stringify({ candidateNodes: [node()], candidateRelations: [] });
    const out = parse(undefined, `\`\`\`json\n${payload}\n\`\`\``);

    expect(out.candidateNodes).toHaveLength(1);
  });

  test("fills in the missing sourceSessionId and confidence the model omits", () => {
    const bare = {
      id: "bare-node",
      type: "concept",
      summary: "No confidence given",
      reasoning: "Because",
    };
    const out = parse({ candidateNodes: [bare], candidateRelations: [] });

    expect(out.candidateNodes).toHaveLength(1);
    expect(out.candidateNodes[0]?.sourceSessionId).toBe("sess-1");
    expect(out.candidateNodes[0]?.confidence).toBe(0.5);
  });

  test("reports usage and model back to the caller", () => {
    const out = parse({ candidateNodes: [node()], candidateRelations: [] });

    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(out.modelUsed).toBe("test-model");
  });
});
