import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { toolCreate, toolGet, toolLink, toolRelated, toolSearch } from "../src/tools.ts";

const FIXTURES = join(import.meta.dir, "fixtures/graph");
const TMP_BASE = `/tmp/litopys-mcp-tools-${Date.now()}`;
let tmpDir: string;
let counter = 0;

beforeEach(() => {
  counter++;
  tmpDir = `${TMP_BASE}/test-${counter}`;
  // Copy fixtures to tmp so create/link tests don't pollute the fixture
  cpSync(FIXTURES, tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// litopys_search
// ---------------------------------------------------------------------------

describe("litopys_search", () => {
  test("finds node by exact name match with high score", async () => {
    const result = await toolSearch({ query: "alice", limit: 20 }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    const alice = result.data.find((h) => h.id === "alice");
    expect(alice).toBeDefined();
    expect(alice?.score).toBeGreaterThanOrEqual(5);
  });

  test("finds node by body keyword", async () => {
    const result = await toolSearch({ query: "scraping", limit: 20 }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    const hit = result.data.find((h) => h.id === "alpha-project");
    expect(hit).toBeDefined();
  });

  test("respects types filter", async () => {
    const result = await toolSearch({ query: "simplicity", types: ["concept"], limit: 20 }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const hit of result.data) {
      expect(hit.type).toBe("concept");
    }
  });

  test("returns empty array for no matches", async () => {
    const result = await toolSearch({ query: "xyznonexistent999", limit: 20 }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
  });

  test("respects limit", async () => {
    const result = await toolSearch({ query: "a", limit: 2 }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeLessThanOrEqual(2);
  });

  test("results are sorted by score descending", async () => {
    const result = await toolSearch({ query: "alice engineer", limit: 20 }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let i = 1; i < result.data.length; i++) {
      expect(result.data[i - 1]?.score).toBeGreaterThanOrEqual(result.data[i]?.score ?? 0);
    }
  });

  test("alias match adds score", async () => {
    const result = await toolSearch({ query: "alice smith", limit: 20 }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alice = result.data.find((h) => h.id === "alice");
    expect(alice).toBeDefined();
    expect(alice?.score).toBeGreaterThan(0);
  });

  test("tag match adds score", async () => {
    const result = await toolSearch({ query: "engineer", limit: 20 }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alice = result.data.find((h) => h.id === "alice");
    expect(alice).toBeDefined();
    expect(alice?.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// litopys_get
// ---------------------------------------------------------------------------

describe("litopys_get", () => {
  test("gets node by id", async () => {
    const result = await toolGet({ id: "alice", include_edges: false }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.node.id).toBe("alice");
    expect(result.data.node.type).toBe("person");
  });

  test("gets node by alias", async () => {
    const result = await toolGet({ id: "Alice Smith", include_edges: false }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.node.id).toBe("alice");
  });

  test("returns error for non-existent node", async () => {
    const result = await toolGet({ id: "no-such-node", include_edges: false }, tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no-such-node");
  });

  test("includes outgoing edges when include_edges=true", async () => {
    const result = await toolGet({ id: "alice", include_edges: true }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outgoing.length).toBeGreaterThan(0);
    const ownsEdge = result.data.outgoing.find((e) => e.relation === "owns");
    expect(ownsEdge).toBeDefined();
  });

  test("has empty edges when include_edges=false", async () => {
    const result = await toolGet({ id: "alice", include_edges: false }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.incoming).toHaveLength(0);
    expect(result.data.outgoing).toHaveLength(0);
  });

  test("incoming edges reference nodes pointing to this one", async () => {
    const result = await toolGet({ id: "alpha-project", include_edges: true }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const incoming = result.data.incoming;
    const ownsEdge = incoming.find((e) => e.from === "alice" && e.relation === "owns");
    expect(ownsEdge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// litopys_create
// ---------------------------------------------------------------------------

describe("litopys_create", () => {
  test("creates a new node", async () => {
    const result = await toolCreate(
      {
        type: "concept",
        id: "new-concept",
        name: "A brand new concept",
        body: "This concept is new.",
        tags: ["new"],
      },
      tmpDir,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe("new-concept");

    // Verify it can be loaded
    const get = await toolGet({ id: "new-concept", include_edges: false }, tmpDir);
    expect(get.ok).toBe(true);
    if (!get.ok) return;
    expect(get.data.node.summary).toBe("A brand new concept");
  });

  test("returns error if id already exists", async () => {
    const result = await toolCreate(
      { type: "person", id: "alice", name: "Duplicate Alice" },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("alice");
  });

  test("creates node with relations", async () => {
    const result = await toolCreate(
      {
        type: "lesson",
        id: "new-lesson",
        name: "New lesson",
        relations: [{ type: "applies_to", target: "simplicity" }],
      },
      tmpDir,
    );
    expect(result.ok).toBe(true);
  });

  test("persists aliases", async () => {
    await toolCreate(
      {
        type: "concept",
        id: "alias-concept",
        name: "Alias test",
        aliases: ["AC", "alias-test"],
      },
      tmpDir,
    );
    const get = await toolGet({ id: "AC", include_edges: false }, tmpDir);
    expect(get.ok).toBe(true);
    if (!get.ok) return;
    expect(get.data.node.id).toBe("alias-concept");
  });
});

// ---------------------------------------------------------------------------
// litopys_link
// ---------------------------------------------------------------------------

describe("litopys_link", () => {
  test("adds a relation between two existing nodes", async () => {
    const result = await toolLink(
      {
        relation_type: "uses",
        source_id: "alpha-project",
        target_id: "web-server",
      },
      tmpDir,
    );
    expect(result.ok).toBe(true);
  });

  test("is no-op if relation already exists (depends_on alpha->web-server)", async () => {
    // alpha-project already depends_on web-server
    const result = await toolLink(
      {
        relation_type: "depends_on",
        source_id: "alpha-project",
        target_id: "web-server",
      },
      tmpDir,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.source).toBe("alpha-project");
  });

  test("returns error if source not found", async () => {
    const result = await toolLink(
      { relation_type: "uses", source_id: "ghost", target_id: "web-server" },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ghost");
  });

  test("returns error with hint if target not found", async () => {
    const result = await toolLink(
      { relation_type: "uses", source_id: "alpha-project", target_id: "phantom" },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("phantom");
    expect(result.error).toContain("litopys_create");
  });

  test("persists link so it shows in edges", async () => {
    await toolLink(
      { relation_type: "depends_on", source_id: "alpha-project", target_id: "web-server" },
      tmpDir,
    );
    const get = await toolGet({ id: "alpha-project", include_edges: true }, tmpDir);
    expect(get.ok).toBe(true);
    if (!get.ok) return;
    const edge = get.data.outgoing.find(
      (e) => e.relation === "depends_on" && e.to === "web-server",
    );
    expect(edge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// litopys_related
// ---------------------------------------------------------------------------

describe("litopys_related", () => {
  test("returns connected nodes at depth 1", async () => {
    const result = await toolRelated({ id: "alice", depth: 1, direction: "out" }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.nodes.map((n) => n.id);
    expect(ids).toContain("alpha-project");
  });

  test("returns empty nodes for isolated node", async () => {
    // web-server has no outgoing edges
    const result = await toolRelated({ id: "web-server", depth: 1, direction: "out" }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nodes).toHaveLength(0);
  });

  test("direction=in returns incoming neighbors", async () => {
    const result = await toolRelated({ id: "alpha-project", depth: 1, direction: "in" }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.nodes.map((n) => n.id);
    expect(ids).toContain("alice");
  });

  test("filters by relation_type", async () => {
    const result = await toolRelated(
      { id: "alice", depth: 1, direction: "out", relation_type: "owns" },
      tmpDir,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const edge of result.data.edges) {
      expect(edge.relation).toBe("owns");
    }
  });

  test("returns error for unknown node", async () => {
    const result = await toolRelated({ id: "ghost-node", depth: 1, direction: "both" }, tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ghost-node");
  });

  test("depth=2 reaches two hops away", async () => {
    // alice -owns-> alpha-project -runs_on-> web-server
    const result = await toolRelated({ id: "alice", depth: 2, direction: "out" }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.nodes.map((n) => n.id);
    expect(ids).toContain("web-server");
  });

  test("resolves by alias", async () => {
    const result = await toolRelated({ id: "Alice Smith", depth: 1, direction: "out" }, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.nodes.map((n) => n.id);
    expect(ids).toContain("alpha-project");
  });
});
