import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeNode } from "@litopys/core";
import { cmdCheck } from "../src/check.ts";

describe("cmdCheck", () => {
  let tmpDir: string;
  let graphDir: string;
  let stdoutBuf: string;
  let stderrBuf: string;
  let origWrite: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  let origExit: typeof process.exit;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-check-test-"));
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
    // throw instead of exit so tests can assert on the code
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

  test("empty graph reports OK", async () => {
    await cmdCheck([], graphDir);
    expect(stdoutBuf).toContain("Scanned 0 node(s)");
    expect(stdoutBuf).toContain("OK");
  });

  test("clean graph reports OK", async () => {
    await writeNode(graphDir, {
      id: "alpha-system",
      type: "system",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });
    await writeNode(graphDir, {
      id: "beta-project",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
      rels: { uses: ["alpha-system"] },
    });

    await cmdCheck([], graphDir);
    expect(stdoutBuf).toContain("Scanned 2 node(s), 1 edge(s)");
    expect(stdoutBuf).toContain("OK");
  });

  test("broken reference is detected", async () => {
    await writeNode(graphDir, {
      id: "has-broken-ref",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
      rels: { uses: ["does-not-exist"] },
    });

    try {
      await cmdCheck([], graphDir);
      throw new Error("expected cmdCheck to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stdoutBuf).toContain("broken_ref");
    expect(stdoutBuf).toContain("does-not-exist");
  });

  test("wrong relation type is detected", async () => {
    // event cannot use 'applies_to' (only concept/lesson)
    await writeNode(graphDir, {
      id: "target-project",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });
    await writeNode(graphDir, {
      id: "bad-event",
      type: "event",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
      rels: { applies_to: ["target-project"] },
    });

    try {
      await cmdCheck([], graphDir);
      throw new Error("expected cmdCheck to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stdoutBuf).toContain("wrong_relation_type");
  });

  test("--json output emits structured errors", async () => {
    await writeNode(graphDir, {
      id: "lonely",
      type: "project",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
      rels: { uses: ["missing-target"] },
    });

    try {
      await cmdCheck(["--json"], graphDir);
      throw new Error("expected cmdCheck to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.nodeCount).toBe(1);
    expect(parsed.errorCount).toBeGreaterThan(0);
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(parsed.errors[0].kind).toBe("broken_ref");
  });

  test("--json on clean graph exits 0 with errorCount:0", async () => {
    await writeNode(graphDir, {
      id: "solo",
      type: "concept",
      updated: "2026-04-22",
      confidence: 0.9,
      body: "",
    });

    await cmdCheck(["--json"], graphDir);
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.errorCount).toBe(0);
    expect(parsed.errors).toEqual([]);
  });

  test("unknown flag exits 1", async () => {
    try {
      await cmdCheck(["--bogus"], graphDir);
      throw new Error("expected cmdCheck to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toContain("Unknown check flag: --bogus");
  });
});
