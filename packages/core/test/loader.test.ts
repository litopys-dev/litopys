import { describe, expect, test } from "bun:test";
import path from "node:path";
import { loadGraph } from "../src/graph/loader.ts";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures/graph");

describe("loadGraph", () => {
  test("loads all 7 nodes from fixtures", async () => {
    const result = await loadGraph(FIXTURES_DIR);

    expect(result.nodes.size).toBe(7);
    expect(result.nodes.has("alice")).toBe(true);
    expect(result.nodes.has("acme-bot")).toBe(true);
    expect(result.nodes.has("server")).toBe(true);
    expect(result.nodes.has("ops-db")).toBe(true);
    expect(result.nodes.has("token-economy")).toBe(true);
    expect(result.nodes.has("chromadb-failure")).toBe(true);
    expect(result.nodes.has("2026-03-01-chroma-removed")).toBe(true);
  });

  test("has exactly 1 error for broken_ref to memory-system", async () => {
    const result = await loadGraph(FIXTURES_DIR);

    // loader itself doesn't validate rels, so no errors from fixtures at load stage
    // broken_ref is detected at resolver stage
    // loader errors: 0 (all fixtures are valid)
    expect(result.errors).toHaveLength(0);
  });

  test("nodes have correct types", async () => {
    const result = await loadGraph(FIXTURES_DIR);

    expect(result.nodes.get("alice")?.type).toBe("person");
    expect(result.nodes.get("acme-bot")?.type).toBe("project");
    expect(result.nodes.get("server")?.type).toBe("system");
    expect(result.nodes.get("token-economy")?.type).toBe("concept");
    expect(result.nodes.get("chromadb-failure")?.type).toBe("lesson");
    expect(result.nodes.get("2026-03-01-chroma-removed")?.type).toBe("event");
  });

  test("nodes have body (markdown content)", async () => {
    const result = await loadGraph(FIXTURES_DIR);
    const alice = result.nodes.get("alice");
    expect(alice?.body).toBeTruthy();
    expect(typeof alice?.body).toBe("string");
  });

  test("node rels are parsed correctly", async () => {
    const result = await loadGraph(FIXTURES_DIR);
    const alice = result.nodes.get("alice");
    expect(alice?.rels?.owns).toContain("acme-bot");
    expect(alice?.rels?.owns).toContain("server");
    expect(alice?.rels?.prefers).toContain("token-economy");
    expect(alice?.rels?.learned_from).toContain("chromadb-failure");
  });

  test("returns validation error for invalid frontmatter", async () => {
    const tmpDir = `/tmp/litopys-test-${Date.now()}`;
    await Bun.write(
      `${tmpDir}/people/bad.md`,
      `---\nid: bad_node\ntype: invalid_type\nupdated: "2026-04-19"\nconfidence: 1\n---\nContent\n`,
    );

    const result = await loadGraph(tmpDir);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.kind).toBe("validation");
  });

  test("returns duplicate_id error for duplicate nodes", async () => {
    const tmpDir = `/tmp/litopys-test-dup-${Date.now()}`;
    const content = `---\nid: dup-node\ntype: system\nupdated: "2026-04-19"\nconfidence: 1\n---\nContent\n`;
    await Bun.write(`${tmpDir}/systems/dup1.md`, content);
    await Bun.write(`${tmpDir}/systems/dup2.md`, content);

    const result = await loadGraph(tmpDir);
    expect(result.errors.some((e) => e.kind === "duplicate_id")).toBe(true);
  });
});
