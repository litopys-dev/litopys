import { describe, expect, test } from "bun:test";
import {
  NODE_TYPES_DOC,
  QUALITY_RULES,
  RELATION_TYPES_DOC,
  buildSystemPrompt,
  buildUserPrompt,
} from "../src/prompt.ts";

describe("buildSystemPrompt", () => {
  test("snapshot — prompt is stable", () => {
    const prompt = buildSystemPrompt();
    // Must contain all 6 node types
    expect(prompt).toContain("person");
    expect(prompt).toContain("project");
    expect(prompt).toContain("system");
    expect(prompt).toContain("concept");
    expect(prompt).toContain("event");
    expect(prompt).toContain("lesson");
  });

  test("contains all 10 relation types", () => {
    const prompt = buildSystemPrompt();
    const relations = [
      "owns",
      "prefers",
      "learned_from",
      "uses",
      "applies_to",
      "conflicts_with",
      "runs_on",
      "depends_on",
      "reinforces",
      "mentioned_in",
    ];
    for (const rel of relations) {
      expect(prompt).toContain(rel);
    }
  });

  test("contains quality rules", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("reasoning");
    expect(prompt).toContain("kebab-case");
  });

  test("mentions JSON output format", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("candidateNodes");
    expect(prompt).toContain("candidateRelations");
    expect(prompt).toContain("sourceSessionId");
  });

  test("warns against extracting one-off details", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/one-off|file path|port number/);
  });

  test("mentions existingNodeIds deduplication", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/duplicate|existing/);
  });

  test("is deterministic across calls", () => {
    expect(buildSystemPrompt()).toBe(buildSystemPrompt());
  });
});

describe("buildUserPrompt", () => {
  test("includes session id", () => {
    const prompt = buildUserPrompt(
      { transcript: "Alice uses TypeScript", existingNodeIds: [] },
      "my-session-123",
    );
    expect(prompt).toContain("my-session-123");
  });

  test("includes transcript text", () => {
    const transcript = "Alice prefers strict TypeScript settings";
    const prompt = buildUserPrompt({ transcript, existingNodeIds: [] }, "s1");
    expect(prompt).toContain(transcript);
  });

  test("includes existing node ids when provided", () => {
    const prompt = buildUserPrompt(
      { transcript: "test", existingNodeIds: ["alice", "bun-runtime"] },
      "s1",
    );
    expect(prompt).toContain("alice");
    expect(prompt).toContain("bun-runtime");
  });

  test("shows 'none' when no existing ids", () => {
    const prompt = buildUserPrompt({ transcript: "test", existingNodeIds: [] }, "s1");
    expect(prompt).toContain("none");
  });

  test("respects maxCandidates option", () => {
    const prompt = buildUserPrompt(
      { transcript: "test", existingNodeIds: [], maxCandidates: 5 },
      "s1",
    );
    expect(prompt).toContain("5");
  });

  test("defaults maxCandidates to 20", () => {
    const prompt = buildUserPrompt({ transcript: "test", existingNodeIds: [] }, "s1");
    expect(prompt).toContain("20");
  });
});

describe("prompt constants", () => {
  test("NODE_TYPES_DOC includes all types", () => {
    for (const t of ["person", "project", "system", "concept", "event", "lesson"]) {
      expect(NODE_TYPES_DOC).toContain(t);
    }
  });

  test("RELATION_TYPES_DOC includes all relations", () => {
    for (const r of ["owns", "prefers", "learned_from", "uses", "applies_to"]) {
      expect(RELATION_TYPES_DOC).toContain(r);
    }
  });

  test("QUALITY_RULES mentions confidence threshold", () => {
    expect(QUALITY_RULES).toContain("confidence");
  });
});
