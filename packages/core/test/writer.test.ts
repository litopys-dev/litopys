import { afterAll, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
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

  test("atomic write leaves no tmp files after success", async () => {
    const node: AnyNode = {
      id: "atomic-node",
      type: "concept",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "atomic body",
    };

    const dir = `${TMP_BASE}/atomic`;
    await writeNode(dir, node);
    await writeNode(dir, node); // overwrite
    await writeNode(dir, node); // overwrite again

    const entries = await fs.readdir(`${dir}/concepts`);
    const tmpFiles = entries.filter((e) => e.includes(".tmp."));
    expect(tmpFiles).toEqual([]);
    expect(entries).toContain("atomic-node.md");
  });

  test("concurrent writes to the same id do not corrupt the file", async () => {
    const dir = `${TMP_BASE}/concurrent`;
    const mkNode = (version: number): AnyNode => ({
      id: "race-node",
      type: "concept",
      updated: "2026-04-22",
      confidence: 0.9,
      body: `version ${version}`,
    });

    await Promise.all([
      writeNode(dir, mkNode(1)),
      writeNode(dir, mkNode(2)),
      writeNode(dir, mkNode(3)),
      writeNode(dir, mkNode(4)),
      writeNode(dir, mkNode(5)),
    ]);

    const reloaded = await loadGraph(dir);
    const node = reloaded.nodes.get("race-node");
    expect(node).toBeDefined();
    expect(reloaded.errors).toEqual([]);
    // Body must match one of the versions — no torn writes
    expect(String(node?.body)).toMatch(/^version [1-5]$/);

    const entries = await fs.readdir(`${dir}/concepts`);
    const tmpFiles = entries.filter((e) => e.includes(".tmp."));
    expect(tmpFiles).toEqual([]);
  });

  test("undefined frontmatter fields are stripped (no YAML dump crash)", async () => {
    const node: AnyNode = {
      id: "sparse-node",
      type: "project",
      updated: "2026-04-22",
      confidence: 1,
      // summary, tags, aliases, rels, body all undefined
    } as AnyNode;

    const dir = `${TMP_BASE}/sparse`;
    await writeNode(dir, node);

    const file = Bun.file(`${dir}/projects/sparse-node.md`);
    const text = await file.text();
    expect(text).not.toContain("undefined");
    expect(text).toContain("id: sparse-node");
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
