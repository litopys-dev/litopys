import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeNode } from "@litopys/core";
import type { Server } from "bun";

// The viewer server reads LITOPYS_GRAPH_PATH via defaultGraphPath(), and caches
// the resolved graph for 2 s. Each test gets a fresh temp dir + re-imported module
// so caches don't bleed across tests.

describe("viewer write API", () => {
  let tmpDir: string;
  let graphDir: string;
  let server: Server<undefined>;
  let base: string;

  const TEST_TOKEN = "test-viewer-token";
  const authedHeaders = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${TEST_TOKEN}`,
    ...extra,
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-viewer-api-"));
    graphDir = path.join(tmpDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });
    process.env.LITOPYS_GRAPH_PATH = graphDir;

    // Fresh module import so the in-process cache is fresh per test.
    const ts = Date.now();
    const modUrl = new URL(`../src/server.ts?cachebust=${ts}-${Math.random()}`, import.meta.url);
    const { createServer } = (await import(modUrl.href)) as typeof import("../src/server.ts");
    server = createServer({
      port: 0,
      bindAddr: "127.0.0.1",
      auth: { mode: "writable", token: TEST_TOKEN },
    });
    base = `http://localhost:${server.port}`;
  });

  afterEach(async () => {
    server.stop(true);
    await fs.rm(tmpDir, { recursive: true, force: true });
    process.env.LITOPYS_GRAPH_PATH = undefined;
  });

  test("POST /api/node creates a node", async () => {
    const res = await fetch(`${base}/api/node`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        id: "viewer-test-concept",
        type: "concept",
        summary: "Created via API",
        tags: ["test"],
        confidence: 0.85,
      }),
    });

    expect(res.status).toBe(201);
    const payload = (await res.json()) as { node: { id: string; summary: string } };
    expect(payload.node.id).toBe("viewer-test-concept");
    expect(payload.node.summary).toBe("Created via API");

    const file = Bun.file(`${graphDir}/concepts/viewer-test-concept.md`);
    expect(await file.exists()).toBe(true);
  });

  test("POST /api/node rejects invalid type", async () => {
    const res = await fetch(`${base}/api/node`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: "bad", type: "banana", summary: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/node conflicts on duplicate id", async () => {
    await writeNode(graphDir, {
      id: "already-here",
      type: "concept",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });

    const res = await fetch(`${base}/api/node`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        id: "already-here",
        type: "concept",
        summary: "dup",
      }),
    });
    expect(res.status).toBe(409);
  });

  test("PUT /api/node/:id updates summary and confidence", async () => {
    await writeNode(graphDir, {
      id: "to-update",
      type: "project",
      updated: "2026-04-20",
      confidence: 0.5,
      body: "",
    });

    const res = await fetch(`${base}/api/node/to-update`, {
      method: "PUT",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ summary: "updated summary", confidence: 0.95 }),
    });
    expect(res.status).toBe(200);

    const { node } = (await res.json()) as {
      node: { summary: string; confidence: number; updated: string };
    };
    expect(node.summary).toBe("updated summary");
    expect(node.confidence).toBe(0.95);
    // updated should be bumped to today
    expect(node.updated).toBe(new Date().toISOString().slice(0, 10));
  });

  test("DELETE /api/node/:id tombstones the node (soft delete)", async () => {
    await writeNode(graphDir, {
      id: "to-tombstone",
      type: "concept",
      updated: "2026-04-20",
      confidence: 0.9,
      body: "",
    });

    const res = await fetch(`${base}/api/node/to-tombstone`, {
      method: "DELETE",
      headers: authedHeaders(),
    });
    expect(res.status).toBe(204);

    // File still exists (soft delete), but `until` is set.
    const file = Bun.file(`${graphDir}/concepts/to-tombstone.md`);
    expect(await file.exists()).toBe(true);
    const text = await file.text();
    expect(text).toContain("until:");
  });

  test("POST /api/node/:id/relation adds a valid relation", async () => {
    await writeNode(graphDir, {
      id: "src-project",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });
    await writeNode(graphDir, {
      id: "dst-system",
      type: "system",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });

    const res = await fetch(`${base}/api/node/src-project/relation`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ relation: "uses", target: "dst-system" }),
    });
    expect(res.status).toBe(200);
    const { node } = (await res.json()) as {
      node: { rels?: Record<string, string[]> };
    };
    expect(node.rels?.uses).toEqual(["dst-system"]);
  });

  test("POST /api/node/:id/relation rejects type-invalid relations", async () => {
    await writeNode(graphDir, {
      id: "some-event",
      type: "event",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });
    await writeNode(graphDir, {
      id: "some-project",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });

    // event cannot use 'applies_to' (only concept/lesson)
    const res = await fetch(`${base}/api/node/some-event/relation`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ relation: "applies_to", target: "some-project" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("event");
  });

  test("DELETE /api/node/:id/relation removes an existing relation", async () => {
    await writeNode(graphDir, {
      id: "parent-project",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
      rels: { uses: ["child-system"] },
    });
    await writeNode(graphDir, {
      id: "child-system",
      type: "system",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });

    const res = await fetch(`${base}/api/node/parent-project/relation`, {
      method: "DELETE",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ relation: "uses", target: "child-system" }),
    });
    expect(res.status).toBe(200);
    const { node } = (await res.json()) as { node: { rels?: Record<string, string[]> } };
    expect(node.rels?.uses).toBeUndefined();
  });

  test("GET /api/graph returns cytoscape-formatted nodes/edges", async () => {
    await writeNode(graphDir, {
      id: "n1",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });
    await writeNode(graphDir, {
      id: "n2",
      type: "system",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });
    await writeNode(graphDir, {
      id: "n3",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
      rels: { uses: ["n2"] },
    });

    const res = await fetch(`${base}/api/graph`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      nodes: Array<{ data: { id: string; type: string } }>;
      edges: Array<{ data: { source: string; target: string; relation: string } }>;
    };
    expect(payload.nodes.map((n) => n.data.id).sort()).toEqual(["n1", "n2", "n3"]);
    const usesEdges = payload.edges.filter((e) => e.data.relation === "uses");
    expect(usesEdges.length).toBe(1);
    expect(usesEdges[0]?.data.source).toBe("n3");
    expect(usesEdges[0]?.data.target).toBe("n2");
  });

  test("POST /api/node without bearer returns 401", async () => {
    const res = await fetch(`${base}/api/node`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "x", type: "concept", summary: "y" }),
    });
    expect(res.status).toBe(401);
  });

  test("GET endpoints stay open without bearer", async () => {
    const stats = await fetch(`${base}/api/stats`);
    expect(stats.status).toBe(200);
    const nodes = await fetch(`${base}/api/nodes`);
    expect(nodes.status).toBe(200);
    const graph = await fetch(`${base}/api/graph`);
    expect(graph.status).toBe(200);
  });

  test("POST /api/node with wrong bearer returns 401", async () => {
    const res = await fetch(`${base}/api/node`, {
      method: "POST",
      headers: { Authorization: "Bearer not-the-real-token", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "x", type: "concept", summary: "y" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("viewer auth modes (resolveViewerAuth)", () => {
  test("loopback bind without token → read-only", async () => {
    const ts = Date.now();
    const modUrl = new URL(`../src/server.ts?cachebust=${ts}-${Math.random()}`, import.meta.url);
    const { resolveViewerAuth } = (await import(modUrl.href)) as typeof import("../src/server.ts");
    expect(resolveViewerAuth("127.0.0.1", undefined).mode).toBe("read-only");
    expect(resolveViewerAuth("::1", undefined).mode).toBe("read-only");
    expect(resolveViewerAuth("localhost", undefined).mode).toBe("read-only");
  });

  test("non-loopback bind without token → refuse-mutating-from-remote", async () => {
    const ts = Date.now();
    const modUrl = new URL(`../src/server.ts?cachebust=${ts}-${Math.random()}`, import.meta.url);
    const { resolveViewerAuth } = (await import(modUrl.href)) as typeof import("../src/server.ts");
    expect(resolveViewerAuth("0.0.0.0", undefined).mode).toBe("refuse-mutating-from-remote");
    expect(resolveViewerAuth("192.168.1.10", undefined).mode).toBe("refuse-mutating-from-remote");
  });

  test("any bind with token → writable", async () => {
    const ts = Date.now();
    const modUrl = new URL(`../src/server.ts?cachebust=${ts}-${Math.random()}`, import.meta.url);
    const { resolveViewerAuth } = (await import(modUrl.href)) as typeof import("../src/server.ts");
    expect(resolveViewerAuth("127.0.0.1", "secret").mode).toBe("writable");
    expect(resolveViewerAuth("0.0.0.0", "secret").mode).toBe("writable");
  });
});

describe("viewer read-only mode rejects mutations", () => {
  let tmpDir: string;
  let graphDir: string;
  let server: Server<undefined>;
  let base: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-viewer-readonly-"));
    graphDir = path.join(tmpDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });
    process.env.LITOPYS_GRAPH_PATH = graphDir;

    const ts = Date.now();
    const modUrl = new URL(`../src/server.ts?cachebust=${ts}-${Math.random()}`, import.meta.url);
    const { createServer } = (await import(modUrl.href)) as typeof import("../src/server.ts");
    server = createServer({
      port: 0,
      bindAddr: "127.0.0.1",
      auth: { mode: "read-only", token: undefined },
    });
    base = `http://localhost:${server.port}`;
  });

  afterEach(async () => {
    server.stop(true);
    await fs.rm(tmpDir, { recursive: true, force: true });
    process.env.LITOPYS_GRAPH_PATH = undefined;
  });

  test("POST /api/node returns 403 in read-only mode", async () => {
    const res = await fetch(`${base}/api/node`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "blocked", type: "concept", summary: "x" }),
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/stats still works in read-only mode", async () => {
    const res = await fetch(`${base}/api/stats`);
    expect(res.status).toBe(200);
  });
});
