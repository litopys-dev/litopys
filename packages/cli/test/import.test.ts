import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadGraph, writeNode } from "@litopys/core";
import { cmdImport } from "../src/import.ts";

describe("cmdImport", () => {
  let tmpDir: string;
  let graphDir: string;
  let snapshotPath: string;
  let stdoutBuf: string;
  let stderrBuf: string;
  let origWrite: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  let origExit: typeof process.exit;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-import-test-"));
    graphDir = path.join(tmpDir, "graph");
    snapshotPath = path.join(tmpDir, "snapshot.json");
    await fs.mkdir(graphDir, { recursive: true });

    stdoutBuf = "";
    stderrBuf = "";
    origWrite = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    origExit = process.exit.bind(process);

    process.stdout.write = ((s: string) => {
      stdoutBuf += s;
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => {
      stderrBuf += s;
      return true;
    }) as typeof process.stderr.write;
    process.exit = ((code?: number) => {
      throw new Error(`__EXIT__${code ?? 0}`);
    }) as typeof process.exit;
  });

  afterEach(async () => {
    process.stdout.write = origWrite;
    process.stderr.write = origErr;
    process.exit = origExit;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function writeSnapshot(payload: unknown): Promise<void> {
    return fs.writeFile(snapshotPath, JSON.stringify(payload), "utf-8");
  }

  test("creates new nodes from a valid snapshot", async () => {
    await writeSnapshot({
      meta: { schemaVersion: 1, nodeCount: 2, edgeCount: 0, exportedAt: "2026-04-24T00:00:00Z" },
      nodes: [
        { id: "alpha", type: "concept", updated: "2026-04-24", confidence: 1, body: "A" },
        { id: "beta", type: "concept", updated: "2026-04-24", confidence: 1, body: "B" },
      ],
      edges: [],
    });

    await cmdImport([snapshotPath], graphDir);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.size).toBe(2);
    expect(loaded.nodes.get("alpha")?.type).toBe("concept");
    expect(loaded.nodes.get("beta")?.type).toBe("concept");
    expect(stdoutBuf).toContain("create 2");
  });

  test("--dry-run does not write anything", async () => {
    await writeSnapshot({
      meta: { schemaVersion: 1, nodeCount: 1, edgeCount: 0, exportedAt: "2026-04-24T00:00:00Z" },
      nodes: [{ id: "solo", type: "concept", updated: "2026-04-24", confidence: 1, body: "" }],
      edges: [],
    });

    await cmdImport([snapshotPath, "--dry-run"], graphDir);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.size).toBe(0);
    expect(stdoutBuf).toContain("[dry-run]");
    expect(stdoutBuf).toContain("+ concept/solo");
  });

  test("skips existing nodes without --force", async () => {
    await writeNode(graphDir, {
      id: "existing",
      type: "concept",
      updated: "2026-04-24",
      confidence: 1,
      body: "original",
    });

    await writeSnapshot({
      meta: { schemaVersion: 1, nodeCount: 1, edgeCount: 0, exportedAt: "2026-04-24T00:00:00Z" },
      nodes: [
        {
          id: "existing",
          type: "concept",
          updated: "2026-04-24",
          confidence: 1,
          body: "overwrite",
        },
      ],
      edges: [],
    });

    await cmdImport([snapshotPath], graphDir);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.get("existing")?.body).toBe("original");
    expect(stdoutBuf).toContain("skip 1");
  });

  test("--force overwrites existing nodes", async () => {
    await writeNode(graphDir, {
      id: "existing",
      type: "concept",
      updated: "2026-04-24",
      confidence: 1,
      body: "original",
    });

    await writeSnapshot({
      meta: { schemaVersion: 1, nodeCount: 1, edgeCount: 0, exportedAt: "2026-04-24T00:00:00Z" },
      nodes: [
        {
          id: "existing",
          type: "concept",
          updated: "2026-04-24",
          confidence: 1,
          body: "overwrite",
        },
      ],
      edges: [],
    });

    await cmdImport([snapshotPath, "--force"], graphDir);
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.get("existing")?.body).toBe("overwrite");
    expect(stdoutBuf).toContain("overwrite 1");
  });

  test("rejects unsupported schemaVersion", async () => {
    await writeSnapshot({ meta: { schemaVersion: 99 }, nodes: [], edges: [] });

    try {
      await cmdImport([snapshotPath], graphDir);
      throw new Error("expected cmdImport to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toContain("Unsupported schemaVersion: 99");
  });

  test("fails fast on invalid node schema", async () => {
    await writeSnapshot({
      meta: { schemaVersion: 1, nodeCount: 1, edgeCount: 0, exportedAt: "2026-04-24T00:00:00Z" },
      nodes: [{ id: "broken", type: "concept" /* missing updated/confidence */ }],
      edges: [],
    });

    try {
      await cmdImport([snapshotPath], graphDir);
      throw new Error("expected cmdImport to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toContain("failed validation");

    // Graph stayed empty — nothing written.
    const loaded = await loadGraph(graphDir);
    expect(loaded.nodes.size).toBe(0);
  });

  test("empty payload exits 1", async () => {
    await writeSnapshot({ meta: { schemaVersion: 1 }, nodes: [], edges: [] });

    try {
      await cmdImport([snapshotPath], graphDir);
      throw new Error("expected cmdImport to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toContain("no nodes");
  });

  test("unknown flag exits 1", async () => {
    try {
      await cmdImport([snapshotPath, "--bogus"], graphDir);
      throw new Error("expected cmdImport to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toContain("Unknown import flag: --bogus");
  });

  test("missing file argument exits 1", async () => {
    try {
      await cmdImport([], graphDir);
      throw new Error("expected cmdImport to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toContain("Usage: litopys import");
  });
});
