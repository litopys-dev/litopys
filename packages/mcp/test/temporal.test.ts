import { beforeEach, describe, expect, test } from "bun:test";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { toolCreate, toolGet, toolLink, toolRelated, toolSearch } from "../src/tools.ts";

const FIXTURES = join(import.meta.dir, "fixtures/graph");
const TMP_BASE = `/tmp/litopys-mcp-temporal-${Date.now()}`;
let tmpDir: string;
let counter = 0;

beforeEach(() => {
  counter++;
  tmpDir = `${TMP_BASE}/test-${counter}`;
  cpSync(FIXTURES, tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// litopys_create: bi-temporal fields persist
// ---------------------------------------------------------------------------

describe("toolCreate persists bi-temporal fields", () => {
  test("stores occurred_at, since, until", async () => {
    const r = await toolCreate(
      {
        type: "system",
        id: "old-ram",
        name: "8GB RAM stick",
        occurred_at: "2026-01-15",
        since: "2026-01-15",
        until: "2026-04-20",
      },
      tmpDir,
    );
    expect(r.ok).toBe(true);

    const got = await toolGet({ id: "old-ram", include_edges: false }, tmpDir);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.data.node.occurred_at).toBe("2026-01-15");
    expect(got.data.node.since).toBe("2026-01-15");
    expect(got.data.node.until).toBe("2026-04-20");
  });
});

// ---------------------------------------------------------------------------
// litopys_search: as_of filter
// ---------------------------------------------------------------------------

describe("toolSearch with as_of", () => {
  test("excludes nodes whose until <= as_of", async () => {
    await toolCreate(
      {
        type: "system",
        id: "ram-old",
        name: "Old RAM 8GB",
        since: "2025-01-01",
        until: "2026-04-20",
      },
      tmpDir,
    );
    await toolCreate(
      {
        type: "system",
        id: "ram-new",
        name: "New RAM 16GB",
        since: "2026-04-20",
      },
      tmpDir,
    );

    // as_of in March: old is still valid, new not yet valid.
    const inMarch = await toolSearch({ query: "ram", limit: 20, as_of: "2026-03-15" }, tmpDir);
    expect(inMarch.ok).toBe(true);
    if (!inMarch.ok) return;
    const idsMarch = inMarch.data.map((h) => h.id);
    expect(idsMarch).toContain("ram-old");
    expect(idsMarch).not.toContain("ram-new");

    // as_of in May: old is tombstoned, new is current.
    const inMay = await toolSearch({ query: "ram", limit: 20, as_of: "2026-05-01" }, tmpDir);
    expect(inMay.ok).toBe(true);
    if (!inMay.ok) return;
    const idsMay = inMay.data.map((h) => h.id);
    expect(idsMay).not.toContain("ram-old");
    expect(idsMay).toContain("ram-new");
  });

  test("without as_of, expired nodes are hidden by default; include_expired surfaces them", async () => {
    await toolCreate(
      {
        type: "system",
        id: "ram-old",
        name: "Old RAM 8GB",
        since: "2025-01-01",
        until: "2026-04-20",
      },
      tmpDir,
    );

    // Default: no as_of → reflects today → tombstoned node is hidden.
    const def = await toolSearch({ query: "ram", limit: 20 }, tmpDir);
    expect(def.ok).toBe(true);
    if (!def.ok) return;
    expect(def.data.map((h) => h.id)).not.toContain("ram-old");

    // Opt-in: include_expired surfaces the tombstoned node again.
    const withExpired = await toolSearch(
      { query: "ram", limit: 20, include_expired: true },
      tmpDir,
    );
    expect(withExpired.ok).toBe(true);
    if (!withExpired.ok) return;
    expect(withExpired.data.map((h) => h.id)).toContain("ram-old");
  });
});

// ---------------------------------------------------------------------------
// litopys_link: supersedes auto-closes target.until
// ---------------------------------------------------------------------------

describe("toolLink supersedes auto-close", () => {
  test("sets target.until = source.since when target.until missing", async () => {
    await toolCreate({ type: "system", id: "ram-v1", name: "RAM v1", since: "2025-01-01" }, tmpDir);
    await toolCreate({ type: "system", id: "ram-v2", name: "RAM v2", since: "2026-04-20" }, tmpDir);

    const linked = await toolLink(
      { relation_type: "supersedes", source_id: "ram-v2", target_id: "ram-v1" },
      tmpDir,
    );
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.data.auto_closed).toEqual({ node: "ram-v1", until: "2026-04-20" });

    const got = await toolGet({ id: "ram-v1", include_edges: false }, tmpDir);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.data.node.until).toBe("2026-04-20");
  });

  test("falls back to source.updated when source.since missing", async () => {
    await toolCreate({ type: "concept", id: "thing-old", name: "Old thing" }, tmpDir);
    await toolCreate({ type: "concept", id: "thing-new", name: "New thing" }, tmpDir);

    const linked = await toolLink(
      { relation_type: "supersedes", source_id: "thing-new", target_id: "thing-old" },
      tmpDir,
    );
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    const today = new Date().toISOString().slice(0, 10);
    expect(linked.data.auto_closed?.until).toBe(today);
  });

  test("does NOT overwrite an existing target.until, but warns", async () => {
    await toolCreate(
      {
        type: "system",
        id: "ram-v1b",
        name: "RAM v1",
        since: "2025-01-01",
        until: "2026-02-01",
      },
      tmpDir,
    );
    await toolCreate(
      { type: "system", id: "ram-v2b", name: "RAM v2", since: "2026-04-20" },
      tmpDir,
    );

    const linked = await toolLink(
      { relation_type: "supersedes", source_id: "ram-v2b", target_id: "ram-v1b" },
      tmpDir,
    );
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.data.auto_closed).toBeUndefined();
    expect(linked.data.warnings?.length).toBeGreaterThan(0);

    const got = await toolGet({ id: "ram-v1b", include_edges: false }, tmpDir);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.data.node.until).toBe("2026-02-01"); // untouched
  });

  test("supersedes chain of 3 closes each predecessor's until correctly", async () => {
    await toolCreate({ type: "concept", id: "v1", name: "v1", since: "2025-01-01" }, tmpDir);
    await toolCreate({ type: "concept", id: "v2", name: "v2", since: "2025-06-01" }, tmpDir);
    await toolCreate({ type: "concept", id: "v3", name: "v3", since: "2026-04-01" }, tmpDir);

    await toolLink({ relation_type: "supersedes", source_id: "v2", target_id: "v1" }, tmpDir);
    await toolLink({ relation_type: "supersedes", source_id: "v3", target_id: "v2" }, tmpDir);

    const v1 = await toolGet({ id: "v1", include_edges: false }, tmpDir);
    const v2 = await toolGet({ id: "v2", include_edges: false }, tmpDir);
    const v3 = await toolGet({ id: "v3", include_edges: false }, tmpDir);
    if (!v1.ok || !v2.ok || !v3.ok) throw new Error("get failed");

    expect(v1.data.node.until).toBe("2025-06-01"); // closed by v2
    expect(v2.data.node.until).toBe("2026-04-01"); // closed by v3
    expect(v3.data.node.until).toBeUndefined(); // current, open

    // as_of after v3.since: only v3 should be valid.
    const r = await toolSearch({ query: "v", limit: 20, as_of: "2026-05-01" }, tmpDir);
    if (!r.ok) throw new Error("search failed");
    const ids = r.data.map((h) => h.id);
    expect(ids).toContain("v3");
    expect(ids).not.toContain("v2");
    expect(ids).not.toContain("v1");

    // as_of in early-2026 should match v2 only.
    const mid = await toolSearch({ query: "v", limit: 20, as_of: "2026-01-15" }, tmpDir);
    if (!mid.ok) throw new Error("search failed");
    const midIds = mid.data.map((h) => h.id);
    expect(midIds).toContain("v2");
    expect(midIds).not.toContain("v1");
    expect(midIds).not.toContain("v3");
  });

  test("non-supersedes relations leave until untouched", async () => {
    await toolCreate({ type: "system", id: "host-a", name: "Host A" }, tmpDir);
    await toolCreate({ type: "project", id: "proj-a", name: "Proj A" }, tmpDir);

    await toolLink({ relation_type: "runs_on", source_id: "proj-a", target_id: "host-a" }, tmpDir);
    const got = await toolGet({ id: "host-a", include_edges: false }, tmpDir);
    if (!got.ok) throw new Error("get failed");
    expect(got.data.node.until).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// litopys_related: as_of
// ---------------------------------------------------------------------------

describe("toolRelated with as_of", () => {
  test("hides neighbours that are tombstoned before as_of", async () => {
    await toolCreate({ type: "person", id: "denis2", name: "Denis" }, tmpDir);
    await toolCreate(
      {
        type: "project",
        id: "proj-old",
        name: "Old project",
        since: "2024-01-01",
        until: "2025-12-31",
      },
      tmpDir,
    );
    await toolCreate(
      { type: "project", id: "proj-new", name: "New project", since: "2026-01-01" },
      tmpDir,
    );
    await toolLink({ relation_type: "owns", source_id: "denis2", target_id: "proj-old" }, tmpDir);
    await toolLink({ relation_type: "owns", source_id: "denis2", target_id: "proj-new" }, tmpDir);

    const inFuture = await toolRelated(
      { id: "denis2", depth: 1, direction: "out", as_of: "2026-05-01" },
      tmpDir,
    );
    expect(inFuture.ok).toBe(true);
    if (!inFuture.ok) return;
    const ids = inFuture.data.nodes.map((n) => n.id);
    expect(ids).toContain("proj-new");
    expect(ids).not.toContain("proj-old");
  });
});
