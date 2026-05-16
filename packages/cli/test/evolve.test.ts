import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type AnyNode, writeNode } from "@litopys/core";

// Mock the LLM SDKs before loading @litopys/extractor. We don't call them in
// this file, but extractor's adapter modules import them at module-graph time
// — without this mock, other tests' mock.module calls would race against the
// real packages already being in the process cache.
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mock(async () => ({ content: [], usage: {} })) };
  },
}));
mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mock(async () => ({ choices: [], usage: {} })) } };
  },
}));
process.env.ANTHROPIC_API_KEY ??= "sk-mock-evolve-test";

const { proposeMerge, writeMergeProposal } = await import("@litopys/extractor");
const { cmdEvolve } = await import("../src/evolve.ts");

function mkNode(partial: Partial<AnyNode> & Pick<AnyNode, "id" | "type">): AnyNode {
  return { updated: "2026-04-21", confidence: 1, ...partial } as AnyNode;
}

describe("cmdEvolve", () => {
  let tmpDir: string;
  let graphDir: string;
  let stdoutBuf: string;
  let stderrBuf: string;
  let origWrite: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  let origExit: typeof process.exit;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-evolve-cli-"));
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

  test("prints usage and exits 1 with no flags", async () => {
    try {
      await cmdEvolve([], graphDir);
      throw new Error("expected cmdEvolve to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toContain("Usage: litopys evolve");
  });

  test("--archive-tombstoned --dry-run lists but does not move", async () => {
    const longAgo = new Date();
    longAgo.setUTCFullYear(longAgo.getUTCFullYear() - 2);
    const longAgoIso = longAgo.toISOString().slice(0, 10);

    await writeNode(graphDir, {
      id: "old",
      type: "system",
      updated: longAgoIso,
      confidence: 1,
      until: longAgoIso,
      body: "",
    });

    await cmdEvolve(["--archive-tombstoned", "--dry-run"], graphDir);
    expect(stdoutBuf).toMatch(/Would archive 1 tombstoned/);

    const stillThere = await fs
      .stat(path.join(graphDir, "systems", "old.md"))
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(true);
  });

  test("--archive-tombstoned --older-than 0 moves a recently-tombstoned node", async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yIso = yesterday.toISOString().slice(0, 10);

    await writeNode(graphDir, {
      id: "yesterday-dead",
      type: "system",
      updated: yIso,
      confidence: 1,
      until: yIso,
      body: "",
    });

    await cmdEvolve(["--archive-tombstoned", "--older-than", "0"], graphDir);
    expect(stdoutBuf).toMatch(/Archived 1 tombstoned/);

    const movedThere = await fs
      .stat(path.join(graphDir, "archive", "systems", "yesterday-dead.md"))
      .then(() => true)
      .catch(() => false);
    expect(movedThere).toBe(true);
  });

  test("rejects unknown flag", async () => {
    try {
      await cmdEvolve(["--bogus"], graphDir);
      throw new Error("expected cmdEvolve to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toContain("Unknown evolve flag: --bogus");
  });

  test("rejects negative --older-than", async () => {
    try {
      await cmdEvolve(["--archive-tombstoned", "--older-than", "-3"], graphDir);
      throw new Error("expected cmdEvolve to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toMatch(/non-negative integer/);
  });

  test("--older-than requires value", async () => {
    try {
      await cmdEvolve(["--archive-tombstoned", "--older-than"], graphDir);
      throw new Error("expected cmdEvolve to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toMatch(/--older-than requires/);
  });

  test("--auto-merge accepts a high-similarity proposal", async () => {
    const qDir = path.join(tmpDir, "quarantine");
    await fs.mkdir(qDir, { recursive: true });

    const a = mkNode({ id: "merge-a", type: "system", confidence: 0.9, body: "" });
    const b = mkNode({ id: "merge-b", type: "system", confidence: 0.7, body: "" });
    await writeNode(graphDir, a);
    await writeNode(graphDir, b);
    const proposal = proposeMerge(a, b, { detectedBy: "similar:0.97" });
    await writeMergeProposal(proposal, qDir);

    await cmdEvolve(["--auto-merge"], graphDir);
    expect(stdoutBuf).toMatch(/Auto-merged 1 proposal/);
    expect(stdoutBuf).toMatch(/merge-b -> merge-a/);
  });

  test("--auto-merge --dry-run does not mutate", async () => {
    const qDir = path.join(tmpDir, "quarantine");
    await fs.mkdir(qDir, { recursive: true });

    const a = mkNode({ id: "dry-merge-a", type: "system", confidence: 0.9, body: "" });
    const b = mkNode({ id: "dry-merge-b", type: "system", confidence: 0.7, body: "" });
    await writeNode(graphDir, a);
    await writeNode(graphDir, b);
    const proposal = proposeMerge(a, b, { detectedBy: "similar:0.99" });
    const proposalPath = await writeMergeProposal(proposal, qDir);

    await cmdEvolve(["--auto-merge", "--dry-run"], graphDir);
    expect(stdoutBuf).toMatch(/Would auto-merge 1 proposal/);

    // Proposal file still present.
    const stillThere = await fs
      .stat(proposalPath)
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(true);
  });

  test("--auto-merge with explicit --min-similarity skips below-threshold proposal", async () => {
    const qDir = path.join(tmpDir, "quarantine");
    await fs.mkdir(qDir, { recursive: true });

    const a = mkNode({ id: "low-a", type: "system", confidence: 0.9, body: "" });
    const b = mkNode({ id: "low-b", type: "system", confidence: 0.7, body: "" });
    await writeNode(graphDir, a);
    await writeNode(graphDir, b);
    const proposal = proposeMerge(a, b, { detectedBy: "similar:0.85" });
    await writeMergeProposal(proposal, qDir);

    await cmdEvolve(["--auto-merge", "--min-similarity", "0.95"], graphDir);
    expect(stdoutBuf).toMatch(/Auto-merged 0 proposal/);
    expect(stdoutBuf).toMatch(/skipped 1/);
  });

  test("--min-similarity rejects out-of-range value", async () => {
    try {
      await cmdEvolve(["--auto-merge", "--min-similarity", "2"], graphDir);
      throw new Error("expected cmdEvolve to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toMatch(/--min-similarity must be 0..1/);
  });

  test("--min-similarity requires value", async () => {
    try {
      await cmdEvolve(["--auto-merge", "--min-similarity"], graphDir);
      throw new Error("expected cmdEvolve to exit");
    } catch (err) {
      expect(String(err)).toContain("__EXIT__1");
    }
    expect(stderrBuf).toMatch(/--min-similarity requires/);
  });

  test("--archive-tombstoned and --auto-merge combine", async () => {
    const qDir = path.join(tmpDir, "quarantine");
    await fs.mkdir(qDir, { recursive: true });

    // One tombstoned node old enough to archive.
    const longAgo = new Date();
    longAgo.setUTCFullYear(longAgo.getUTCFullYear() - 2);
    const longAgoIso = longAgo.toISOString().slice(0, 10);
    await writeNode(graphDir, {
      id: "old-arch",
      type: "system",
      updated: longAgoIso,
      confidence: 1,
      until: longAgoIso,
      body: "",
    });

    // And one merge pair.
    const a = mkNode({ id: "combo-a", type: "system", confidence: 0.9, body: "" });
    const b = mkNode({ id: "combo-b", type: "system", confidence: 0.7, body: "" });
    await writeNode(graphDir, a);
    await writeNode(graphDir, b);
    const proposal = proposeMerge(a, b, { detectedBy: "similar:0.98" });
    await writeMergeProposal(proposal, qDir);

    await cmdEvolve(["--archive-tombstoned", "--auto-merge"], graphDir);
    expect(stdoutBuf).toMatch(/Archived 1 tombstoned/);
    expect(stdoutBuf).toMatch(/Auto-merged 1 proposal/);
  });
});
