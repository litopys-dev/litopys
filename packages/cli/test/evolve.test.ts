import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeNode } from "@litopys/core";
import { cmdEvolve } from "../src/evolve.ts";

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
});
