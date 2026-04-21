import { describe, expect, test } from "bun:test";
import {
  AnyNodeSchema,
  BaseNodeSchema,
  ConceptNodeSchema,
  EventNodeSchema,
  LessonNodeSchema,
  NodeType,
  PersonNodeSchema,
  ProjectNodeSchema,
  RELATION_CONSTRAINTS,
  RelationName,
  SystemNodeSchema,
} from "../src/schema/index.ts";

describe("BaseNodeSchema", () => {
  test("accepts valid base node", () => {
    const result = BaseNodeSchema.safeParse({
      id: "my-node",
      type: "person",
      updated: "2026-04-19",
      confidence: 0.8,
    });
    expect(result.success).toBe(true);
  });

  test("rejects id with uppercase", () => {
    const result = BaseNodeSchema.safeParse({
      id: "MyNode",
      type: "person",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects id with underscores", () => {
    const result = BaseNodeSchema.safeParse({
      id: "my_node",
      type: "person",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects confidence > 1", () => {
    const result = BaseNodeSchema.safeParse({
      id: "my-node",
      type: "person",
      updated: "2026-04-19",
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  test("rejects confidence < 0", () => {
    const result = BaseNodeSchema.safeParse({
      id: "my-node",
      type: "person",
      updated: "2026-04-19",
      confidence: -0.1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid updated format", () => {
    const result = BaseNodeSchema.safeParse({
      id: "my-node",
      type: "person",
      updated: "19-04-2026",
      confidence: 1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects summary > 200 chars", () => {
    const result = BaseNodeSchema.safeParse({
      id: "my-node",
      type: "person",
      updated: "2026-04-19",
      confidence: 1,
      summary: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  test("accepts summary of exactly 200 chars", () => {
    const result = BaseNodeSchema.safeParse({
      id: "my-node",
      type: "person",
      updated: "2026-04-19",
      confidence: 1,
      summary: "x".repeat(200),
    });
    expect(result.success).toBe(true);
  });

  test("accepts valid rels", () => {
    const result = BaseNodeSchema.safeParse({
      id: "my-node",
      type: "person",
      updated: "2026-04-19",
      confidence: 1,
      rels: { owns: ["project-a", "project-b"] },
    });
    expect(result.success).toBe(true);
  });
});

describe("AnyNodeSchema discriminated union", () => {
  test("accepts person node", () => {
    const result = AnyNodeSchema.safeParse({
      id: "a-person",
      type: "person",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("person");
  });

  test("accepts project node", () => {
    const result = AnyNodeSchema.safeParse({
      id: "a-project",
      type: "project",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("project");
  });

  test("accepts system node", () => {
    const result = AnyNodeSchema.safeParse({
      id: "a-system",
      type: "system",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });

  test("accepts concept node", () => {
    const result = AnyNodeSchema.safeParse({
      id: "a-concept",
      type: "concept",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });

  test("accepts event node", () => {
    const result = AnyNodeSchema.safeParse({
      id: "an-event",
      type: "event",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });

  test("accepts lesson node", () => {
    const result = AnyNodeSchema.safeParse({
      id: "a-lesson",
      type: "lesson",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown type", () => {
    const result = AnyNodeSchema.safeParse({
      id: "unknown",
      type: "unknown_type",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing required fields", () => {
    const result = AnyNodeSchema.safeParse({
      id: "missing-fields",
      type: "person",
      // missing updated and confidence
    });
    expect(result.success).toBe(false);
  });
});

describe("NodeType enum", () => {
  test("contains all 6 types", () => {
    const values = NodeType.options;
    expect(values).toContain("person");
    expect(values).toContain("project");
    expect(values).toContain("system");
    expect(values).toContain("concept");
    expect(values).toContain("event");
    expect(values).toContain("lesson");
    expect(values).toHaveLength(6);
  });
});

describe("RelationName enum", () => {
  test("contains all 11 relations", () => {
    const values = RelationName.options;
    expect(values).toHaveLength(11);
    expect(values).toContain("owns");
    expect(values).toContain("prefers");
    expect(values).toContain("learned_from");
    expect(values).toContain("uses");
    expect(values).toContain("applies_to");
    expect(values).toContain("conflicts_with");
    expect(values).toContain("runs_on");
    expect(values).toContain("depends_on");
    expect(values).toContain("reinforces");
    expect(values).toContain("mentioned_in");
    expect(values).toContain("supersedes");
  });
});

describe("RELATION_CONSTRAINTS", () => {
  test("conflicts_with is symmetric", () => {
    expect(RELATION_CONSTRAINTS.conflicts_with.symmetric).toBe(true);
  });

  test("owns is not symmetric", () => {
    expect(RELATION_CONSTRAINTS.owns.symmetric).toBe(false);
  });

  test("owns source is only person", () => {
    expect(RELATION_CONSTRAINTS.owns.sources).toEqual(["person"]);
  });

  test("owns targets are project and system", () => {
    expect(RELATION_CONSTRAINTS.owns.targets).toContain("project");
    expect(RELATION_CONSTRAINTS.owns.targets).toContain("system");
  });

  test("reinforces source is event and lesson", () => {
    expect(RELATION_CONSTRAINTS.reinforces.sources).toContain("event");
    expect(RELATION_CONSTRAINTS.reinforces.sources).toContain("lesson");
  });

  test("reinforces target is concept only", () => {
    expect(RELATION_CONSTRAINTS.reinforces.targets).toEqual(["concept"]);
  });

  test("all 11 relations are defined", () => {
    const keys = Object.keys(RELATION_CONSTRAINTS);
    expect(keys).toHaveLength(11);
  });

  test("supersedes is not symmetric", () => {
    expect(RELATION_CONSTRAINTS.supersedes.symmetric).toBe(false);
  });

  test("supersedes allows any → any", () => {
    expect(RELATION_CONSTRAINTS.supersedes.sources).toHaveLength(6);
    expect(RELATION_CONSTRAINTS.supersedes.targets).toHaveLength(6);
  });
});

describe("Individual node schemas", () => {
  test("PersonNodeSchema rejects wrong type", () => {
    const result = PersonNodeSchema.safeParse({
      id: "not-person",
      type: "project",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(false);
  });

  test("ProjectNodeSchema accepts project type", () => {
    const result = ProjectNodeSchema.safeParse({
      id: "my-project",
      type: "project",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });

  test("SystemNodeSchema rejects person type", () => {
    const result = SystemNodeSchema.safeParse({
      id: "my-system",
      type: "person",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(false);
  });

  test("ConceptNodeSchema accepts concept type", () => {
    const result = ConceptNodeSchema.safeParse({
      id: "my-concept",
      type: "concept",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });

  test("EventNodeSchema accepts event type", () => {
    const result = EventNodeSchema.safeParse({
      id: "my-event",
      type: "event",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });

  test("LessonNodeSchema accepts lesson type", () => {
    const result = LessonNodeSchema.safeParse({
      id: "my-lesson",
      type: "lesson",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });
});
