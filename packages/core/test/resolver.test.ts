import { describe, expect, test } from "bun:test";
import path from "node:path";
import { loadGraph } from "../src/graph/loader.ts";
import { resolveGraph } from "../src/graph/resolver.ts";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures/graph");

describe("resolveGraph", () => {
  test("returns 1 broken_ref error for memory-system", async () => {
    const load = await loadGraph(FIXTURES_DIR);
    const graph = resolveGraph(load);

    const brokenRefs = graph.errors.filter((e) => e.kind === "broken_ref");
    expect(brokenRefs).toHaveLength(1);
    expect(brokenRefs[0]?.message).toContain("memory-system");
  });

  test("builds edges correctly", async () => {
    const load = await loadGraph(FIXTURES_DIR);
    const graph = resolveGraph(load);

    // alice owns acme-bot
    const ownsEdge = graph.edges.find(
      (e) => e.from === "alice" && e.to === "acme-bot" && e.relation === "owns",
    );
    expect(ownsEdge).toBeDefined();

    // acme-bot runs_on server
    const runsOnEdge = graph.edges.find(
      (e) => e.from === "acme-bot" && e.to === "server" && e.relation === "runs_on",
    );
    expect(runsOnEdge).toBeDefined();

    // event reinforces concept
    const reinforcesEdge = graph.edges.find(
      (e) => e.from === "2026-03-01-chroma-removed" && e.to === "token-economy",
    );
    expect(reinforcesEdge).toBeDefined();
  });

  test("symmetric relation creates two edges", async () => {
    const tmpDir = `/tmp/litopys-test-sym-${Date.now()}`;
    const nodeA = `---\nid: node-a\ntype: project\nupdated: "2026-04-19"\nconfidence: 1\nrels:\n  conflicts_with:\n    - node-b\n---\nA\n`;
    const nodeB = `---\nid: node-b\ntype: system\nupdated: "2026-04-19"\nconfidence: 1\n---\nB\n`;
    await Bun.write(`${tmpDir}/projects/node-a.md`, nodeA);
    await Bun.write(`${tmpDir}/systems/node-b.md`, nodeB);

    const load = await loadGraph(tmpDir);
    const graph = resolveGraph(load);

    const aToB = graph.edges.find(
      (e) => e.from === "node-a" && e.to === "node-b" && e.relation === "conflicts_with",
    );
    const bToA = graph.edges.find(
      (e) => e.from === "node-b" && e.to === "node-a" && e.relation === "conflicts_with",
    );

    expect(aToB).toBeDefined();
    expect(bToA).toBeDefined();
    expect(aToB?.symmetric).toBe(true);
    expect(bToA?.symmetric).toBe(true);
  });

  test("wrong_relation_type error for invalid source type", async () => {
    const tmpDir = `/tmp/litopys-test-wrongrel-${Date.now()}`;
    // concept cannot 'owns' anything
    const node = `---\nid: bad-concept\ntype: concept\nupdated: "2026-04-19"\nconfidence: 1\nrels:\n  owns:\n    - some-project\n---\nContent\n`;
    const target = `---\nid: some-project\ntype: project\nupdated: "2026-04-19"\nconfidence: 1\n---\nContent\n`;
    await Bun.write(`${tmpDir}/concepts/bad-concept.md`, node);
    await Bun.write(`${tmpDir}/projects/some-project.md`, target);

    const load = await loadGraph(tmpDir);
    const graph = resolveGraph(load);

    const wrongType = graph.errors.filter((e) => e.kind === "wrong_relation_type");
    expect(wrongType.length).toBeGreaterThan(0);
  });

  test("nodes map is preserved in resolved graph", async () => {
    const load = await loadGraph(FIXTURES_DIR);
    const graph = resolveGraph(load);

    expect(graph.nodes.size).toBe(load.nodes.size);
  });
});
