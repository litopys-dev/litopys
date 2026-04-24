import { afterAll, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { GraphLockTimeoutError, withGraphLock } from "../src/graph/lock.ts";

const TMP_BASE = `/tmp/litopys-lock-${Date.now()}`;

afterAll(async () => {
  await fs.rm(TMP_BASE, { recursive: true, force: true });
});

async function mkGraphDir(name: string): Promise<string> {
  const dir = path.join(TMP_BASE, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe("withGraphLock", () => {
  test("basic cycle — returns value and removes lockfile", async () => {
    const gp = await mkGraphDir("basic");
    const lockPath = path.join(gp, ".lock");

    const result = await withGraphLock(gp, async () => 42);

    expect(result).toBe(42);
    // Lockfile must be gone after release
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  test("exception in fn — lockfile still removed", async () => {
    const gp = await mkGraphDir("exception");
    const lockPath = path.join(gp, ".lock");

    await expect(
      withGraphLock(gp, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Lockfile must be gone even though fn threw
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  test("serial contention — second withGraphLock succeeds after first releases", async () => {
    const gp = await mkGraphDir("serial");

    const first = await withGraphLock(gp, async () => "first");
    const second = await withGraphLock(gp, async () => "second");

    expect(first).toBe("first");
    expect(second).toBe("second");
  });

  test("concurrent — second waits for first to finish", async () => {
    const gp = await mkGraphDir("concurrent-wait");

    const t0 = Date.now();

    // First lock holds for ~150ms
    const p1 = withGraphLock(gp, () => new Promise<string>((r) => setTimeout(() => r("p1"), 150)));

    // Second lock starts 10ms later
    await new Promise<void>((r) => setTimeout(r, 10));
    const p2 = withGraphLock(gp, async () => "p2", { retryIntervalMs: 20 });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe("p1");
    expect(r2).toBe("p2");

    // p2 must have waited: total elapsed > 150ms
    expect(Date.now() - t0).toBeGreaterThan(140);
  });

  test("concurrent timeout — second lock expires with GraphLockTimeoutError", async () => {
    const gp = await mkGraphDir("concurrent-timeout");

    // First lock holds for 1000ms
    const p1 = withGraphLock(gp, () => new Promise<void>((r) => setTimeout(r, 1_000)), {
      timeoutMs: 5_000,
    });

    // Give p1 a moment to acquire the lock
    await new Promise<void>((r) => setTimeout(r, 20));

    // Second lock times out after 100ms
    await expect(
      withGraphLock(gp, async () => "should-not-run", {
        timeoutMs: 100,
        retryIntervalMs: 20,
      }),
    ).rejects.toBeInstanceOf(GraphLockTimeoutError);

    // Clean up p1
    await p1;
  });

  test("stale lock override — old lockfile is replaced and lock acquired", async () => {
    const gp = await mkGraphDir("stale");
    const lockPath = path.join(gp, ".lock");

    // Write a lockfile manually and backdate its mtime to 2 minutes ago
    await fs.writeFile(lockPath, "99999@0\n", "utf-8");
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1_000);
    await fs.utimes(lockPath, twoMinutesAgo, twoMinutesAgo);

    // withGraphLock should detect stale lock (>60s) and proceed
    const result = await withGraphLock(gp, async () => "stale-override", {
      staleAgeMs: 60_000,
      timeoutMs: 1_000,
    });

    expect(result).toBe("stale-override");
    // Lockfile removed after fn completes
    await expect(fs.access(lockPath)).rejects.toThrow();
  });
});
