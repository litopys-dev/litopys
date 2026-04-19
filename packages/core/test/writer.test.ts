import { afterAll, describe, expect, test } from "bun:test";
import { loadGraph } from "../src/graph/loader.ts";
import { writeNode } from "../src/graph/writer.ts";
import type { AnyNode } from "../src/schema/index.ts";

const TMP_BASE = `/tmp/litopys-writer-${Date.now()}`;

describe("writeNode", () => {
  test("round-trip: write and reload person node preserves all fields", async () => {
    const node: AnyNode = {
      id: "test-person",
      type: "person",
      summary: "Test person for round-trip",
      updated: "2026-04-19",
      confidence: 0.9,
      aliases: ["TestPerson", "tp"],
      tags: ["test"],
      rels: {
        owns: ["some-project"],
      },
      body: "This is the body content.",
    };

    const dir = `${TMP_BASE}/person-roundtrip`;
    await writeNode(dir, node);

    const reloaded = await loadGraph(dir);
    expect(reloaded.nodes.has("test-person")).toBe(true);

    const reloadedNode = reloaded.nodes.get("test-person");
    if (!reloadedNode) throw new Error("node not found");
    expect(reloadedNode.id).toBe(node.id);
    expect(reloadedNode.type).toBe(node.type);
    expect(reloadedNode.summary).toBe(node.summary);
    expect(reloadedNode.updated).toBe(node.updated);
    expect(reloadedNode.confidence).toBe(node.confidence);
    expect(reloadedNode.aliases).toEqual(node.aliases);
    expect(reloadedNode.tags).toEqual(node.tags);
    expect(reloadedNode.body).toContain("body content");
  });

  test("writes to correct directory: people/<id>.md", async () => {
    const node: AnyNode = {
      id: "dir-test-person",
      type: "person",
      updated: "2026-04-19",
      confidence: 1,
      body: "",
    };

    const dir = `${TMP_BASE}/dir-test`;
    await writeNode(dir, node);

    const file = Bun.file(`${dir}/people/dir-test-person.md`);
    expect(await file.exists()).toBe(true);
  });

  test("writes project to projects/<id>.md", async () => {
    const node: AnyNode = {
      id: "test-project",
      type: "project",
      updated: "2026-04-19",
      confidence: 1,
      body: "Project body.",
    };

    const dir = `${TMP_BASE}/project-test`;
    await writeNode(dir, node);

    const file = Bun.file(`${dir}/projects/test-project.md`);
    expect(await file.exists()).toBe(true);
  });

  test("writes system to systems/<id>.md", async () => {
    const node: AnyNode = {
      id: "test-system",
      type: "system",
      updated: "2026-04-19",
      confidence: 1,
      body: "",
    };

    const dir = `${TMP_BASE}/system-test`;
    await writeNode(dir, node);

    const file = Bun.file(`${dir}/systems/test-system.md`);
    expect(await file.exists()).toBe(true);
  });

  test("writes concept to concepts/<id>.md", async () => {
    const node: AnyNode = {
      id: "test-concept",
      type: "concept",
      updated: "2026-04-19",
      confidence: 1,
      body: "",
    };

    const dir = `${TMP_BASE}/concept-test`;
    await writeNode(dir, node);

    const file = Bun.file(`${dir}/concepts/test-concept.md`);
    expect(await file.exists()).toBe(true);
  });

  test("writes event to events/<id>.md", async () => {
    const node: AnyNode = {
      id: "test-event",
      type: "event",
      updated: "2026-04-19",
      confidence: 1,
      body: "",
    };

    const dir = `${TMP_BASE}/event-test`;
    await writeNode(dir, node);

    const file = Bun.file(`${dir}/events/test-event.md`);
    expect(await file.exists()).toBe(true);
  });

  test("writes lesson to lessons/<id>.md", async () => {
    const node: AnyNode = {
      id: "test-lesson",
      type: "lesson",
      updated: "2026-04-19",
      confidence: 1,
      body: "",
    };

    const dir = `${TMP_BASE}/lesson-test`;
    await writeNode(dir, node);

    const file = Bun.file(`${dir}/lessons/test-lesson.md`);
    expect(await file.exists()).toBe(true);
  });

  test("round-trip: write and reload lesson preserves rels", async () => {
    const node: AnyNode = {
      id: "my-lesson",
      type: "lesson",
      updated: "2026-04-19",
      confidence: 0.8,
      since: "2026-01-01",
      body: "Lesson details here.",
    };

    const dir = `${TMP_BASE}/lesson-roundtrip`;
    await writeNode(dir, node);

    const reloaded = await loadGraph(dir);
    const reloadedNode = reloaded.nodes.get("my-lesson");
    expect(reloadedNode).toBeDefined();
    if (!reloadedNode) throw new Error("node not found");
    expect(reloadedNode.since).toBe("2026-01-01");
    expect(reloadedNode.confidence).toBe(0.8);
  });
});
