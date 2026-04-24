import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeNode } from "@litopys/core";
import { buildExportPayload, cmdExport } from "../src/export.ts";

describe("cmdExport", () => {
  let tmpDir: string;
  let graphDir: string;
  let stdoutBuf: string;
  let stderrBuf: string;
  let origWrite: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  let origExit: typeof process.exit;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-export-test-"));
    graphDir = path.join(tmpDir, "graph");
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

  test("empty graph exports empty arrays and zero counts", async () => {
    await cmdExport([], graphDir);
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.meta.nodeCount).toBe(0);
    expect(parsed.meta.edgeCount).toBe(0);
    expect(parsed.meta.schemaVersion).toBe(1);
    expect(typeof parsed.meta.exportedAt).toBe("string");
    expect(parsed.meta.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.nodes).toEqual([]);
    expect(parsed.edges).toEqual([]);
  });

  test("populated graph exports sorted nodes and edges", async () => {
    await writeNode(graphDir, {
      id: "zeta-system",
      type: "system",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });
    await writeNode(graphDir, {
      id: "alpha-project",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "hello world",
      rels: { uses: ["zeta-system"] },
    });

    await cmdExport([], graphDir);
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.meta.nodeCount).toBe(2);
    expect(parsed.meta.edgeCount).toBe(1);
    // sorted by id ascending
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual(["alpha-project", "zeta-system"]);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0]).toMatchObject({
      from: "alpha-project",
      to: "zeta-system",
      relation: "uses",
    });
  });

  test("--pretty indents output", async () => {
    await writeNode(graphDir, {
      id: "solo",
      type: "concept",
      updated: "2026-04-22",
      confidence: 1,
      body: "",
    });

    await cmdExport(["--pretty"], graphDir);
    // Pretty output starts with newline+2-space indent inside the object
    expect(stdoutBuf).toContain('\n  "meta":');
    expect(stdoutBuf).toContain('\n  "nodes":');
  });

  test("--no-body strips bodies from output", async () => {
    await writeNode(graphDir, {
      id: "with-body",
      type: "concept",
      updated: "2026-04-22",
      confidence: 1,
      body: "lots of markdown text here",
    });

    await cmdExport(["--no-body"], graphDir);
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].body).toBeUndefined();
    // id/type still present
    expect(parsed.nodes[0].id).toBe("with-body");
    expect(parsed.nodes[0].type).toBe("concept");
  });

  test("default output keeps bodies", async () => {
    await writeNode(graphDir, {
      id: "with-body",
      type: "concept",
      updated: "2026-04-22",
      confidence: 1,
      body: "kept content",
    });

    await cmdExport([], graphDir);
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.nodes[0].body).toBe("kept content");
  });

  test("unknown flag exits 1", async () => {
    try {
      await cmdExport(["--bogus"], graphDir);
      throw new Error("expected cmdExport to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toContain("Unknown export flag: --bogus");
  });

  test("buildExportPayload is deterministic across calls", async () => {
    await writeNode(graphDir, {
      id: "a",
      type: "concept",
      updated: "2026-04-22",
      confidence: 1,
      body: "",
    });
    await writeNode(graphDir, {
      id: "b",
      type: "concept",
      updated: "2026-04-22",
      confidence: 1,
      body: "",
    });

    const now = "2026-04-23T00:00:00.000Z";
    const p1 = await buildExportPayload(graphDir, {
      pretty: false,
      includeBodies: true,
      nowIso: now,
    });
    const p2 = await buildExportPayload(graphDir, {
      pretty: false,
      includeBodies: true,
      nowIso: now,
    });
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });
});
