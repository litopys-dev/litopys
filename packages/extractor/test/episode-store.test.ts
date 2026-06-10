import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendEpisodes,
  listUnclustered,
  markClustered,
} from "../src/episode-store.ts";
import type { Episode } from "../src/episode-store.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: "ep-abc123def456",
    sessionId: "sess-001",
    date: today(),
    goal: "Fix the login bug",
    steps: ["read the error", "trace the call stack", "apply fix"],
    toolOps: 5,
    errorRecovery: false,
    project: "pc-service",
    tags: ["bugfix"],
    clusteredInto: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("appendEpisodes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-ep-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("creates monthly YYYY-MM.jsonl file and returns count", async () => {
    const ep1 = makeEpisode({ id: "ep-aaa111bbb222" });
    const ep2 = makeEpisode({ id: "ep-ccc333ddd444", goal: "Deploy update" });

    const written = await appendEpisodes([ep1, ep2], tmpDir);
    expect(written).toBe(2);

    const yyyyMM = today().slice(0, 7); // "YYYY-MM"
    const expectedFile = path.join(tmpDir, `${yyyyMM}.jsonl`);
    const stat = await fs.stat(expectedFile);
    expect(stat.isFile()).toBe(true);

    const content = await fs.readFile(expectedFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  test("deduplicates by id — repeated append returns 0, file unchanged", async () => {
    const ep1 = makeEpisode({ id: "ep-aaa111bbb222" });
    const ep2 = makeEpisode({ id: "ep-ccc333ddd444" });

    await appendEpisodes([ep1, ep2], tmpDir);

    const written2 = await appendEpisodes([ep1, ep2], tmpDir);
    expect(written2).toBe(0);

    const yyyyMM = today().slice(0, 7);
    const content = await fs.readFile(path.join(tmpDir, `${yyyyMM}.jsonl`), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  test("partial dedup — only new episodes are written", async () => {
    const ep1 = makeEpisode({ id: "ep-aaa111bbb222" });
    const ep2 = makeEpisode({ id: "ep-ccc333ddd444" });
    const ep3 = makeEpisode({ id: "ep-eee555fff666", goal: "New thing" });

    await appendEpisodes([ep1], tmpDir);
    const written = await appendEpisodes([ep1, ep2, ep3], tmpDir);
    expect(written).toBe(2);

    const yyyyMM = today().slice(0, 7);
    const content = await fs.readFile(path.join(tmpDir, `${yyyyMM}.jsonl`), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  test("creates directory if it does not exist", async () => {
    const nestedDir = path.join(tmpDir, "nested", "episodes");
    const ep = makeEpisode({ id: "ep-nested111222" });
    const written = await appendEpisodes([ep], nestedDir);
    expect(written).toBe(1);
    const stat = await fs.stat(nestedDir);
    expect(stat.isDirectory()).toBe(true);
  });

  test("each line is valid JSON with correct id", async () => {
    const ep1 = makeEpisode({ id: "ep-json111aaa" });
    const ep2 = makeEpisode({ id: "ep-json222bbb", goal: "Check JSON" });
    await appendEpisodes([ep1, ep2], tmpDir);

    const yyyyMM = today().slice(0, 7);
    const content = await fs.readFile(path.join(tmpDir, `${yyyyMM}.jsonl`), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const parsed = lines.map((l) => JSON.parse(l) as Episode);
    expect(parsed.map((e) => e.id)).toEqual(["ep-json111aaa", "ep-json222bbb"]);
  });
});

describe("listUnclustered", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-ep-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array when directory does not exist", async () => {
    const result = await listUnclustered(path.join(tmpDir, "nonexistent"));
    expect(result).toHaveLength(0);
  });

  test("returns empty array for empty directory", async () => {
    const result = await listUnclustered(tmpDir);
    expect(result).toHaveLength(0);
  });

  test("returns unclustered episodes within default sinceDays window", async () => {
    const ep1 = makeEpisode({ id: "ep-list111aaa" });
    const ep2 = makeEpisode({ id: "ep-list222bbb", goal: "Second goal" });
    await appendEpisodes([ep1, ep2], tmpDir);

    const result = await listUnclustered(tmpDir);
    expect(result).toHaveLength(2);
  });

  test("excludes clustered episodes", async () => {
    const ep1 = makeEpisode({ id: "ep-cluster111", clusteredInto: "restart-syut" });
    const ep2 = makeEpisode({ id: "ep-cluster222", goal: "Still unclustered" });
    await appendEpisodes([ep1, ep2], tmpDir);

    const result = await listUnclustered(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("ep-cluster222");
  });

  test("corrupted line in jsonl does not crash reading", async () => {
    const yyyyMM = today().slice(0, 7);
    const filePath = path.join(tmpDir, `${yyyyMM}.jsonl`);
    await fs.mkdir(tmpDir, { recursive: true });

    const ep = makeEpisode({ id: "ep-corrupt111" });
    // Write one valid line, one corrupted line, one valid line
    const validLine = JSON.stringify(ep);
    const corruptLine = "NOT JSON {{{";
    const anotherEp = makeEpisode({ id: "ep-corrupt222", goal: "After corrupt" });
    const anotherLine = JSON.stringify(anotherEp);

    await fs.writeFile(filePath, [validLine, corruptLine, anotherLine].join("\n") + "\n", "utf-8");

    const result = await listUnclustered(tmpDir);
    // Only valid, unclustered episodes returned; corrupted line skipped
    expect(result.map((e) => e.id)).toEqual(
      expect.arrayContaining(["ep-corrupt111", "ep-corrupt222"]),
    );
    expect(result).toHaveLength(2);
  });

  test("episodes outside sinceDays window are excluded", async () => {
    // Write an episode with a date far in the past (101 days ago)
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 101);
    const pastDateStr = pastDate.toISOString().slice(0, 10);
    const pastYYYYMM = pastDateStr.slice(0, 7);

    const oldEp = makeEpisode({ id: "ep-old111aaa", date: pastDateStr });
    // Manually write to the old month's file
    await fs.mkdir(tmpDir, { recursive: true });
    const oldFile = path.join(tmpDir, `${pastYYYYMM}.jsonl`);
    await fs.appendFile(oldFile, JSON.stringify(oldEp) + "\n", "utf-8");

    const recentEp = makeEpisode({ id: "ep-recent111" });
    await appendEpisodes([recentEp], tmpDir);

    const result = await listUnclustered(tmpDir, 60);
    expect(result.map((e) => e.id)).not.toContain("ep-old111aaa");
    expect(result.map((e) => e.id)).toContain("ep-recent111");
  });
});

describe("markClustered", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-ep-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("marks episode as clustered and removes from listUnclustered", async () => {
    const ep1 = makeEpisode({ id: "ep-mark111aaa" });
    const ep2 = makeEpisode({ id: "ep-mark222bbb", goal: "Other goal" });
    await appendEpisodes([ep1, ep2], tmpDir);

    await markClustered(["ep-mark111aaa"], "restart-syut", tmpDir);

    const unclustered = await listUnclustered(tmpDir);
    expect(unclustered).toHaveLength(1);
    expect(unclustered[0]?.id).toBe("ep-mark222bbb");
  });

  test("clusteredInto field is persisted in the jsonl file", async () => {
    const ep = makeEpisode({ id: "ep-persist111" });
    await appendEpisodes([ep], tmpDir);

    await markClustered(["ep-persist111"], "deploy-feature", tmpDir);

    const yyyyMM = today().slice(0, 7);
    const content = await fs.readFile(path.join(tmpDir, `${yyyyMM}.jsonl`), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const parsed = lines.map((l) => JSON.parse(l) as Episode);
    const found = parsed.find((e) => e.id === "ep-persist111");
    expect(found?.clusteredInto).toBe("deploy-feature");
  });

  test("non-existent ids are silently ignored", async () => {
    const ep = makeEpisode({ id: "ep-ignore111" });
    await appendEpisodes([ep], tmpDir);

    await expect(
      markClustered(["ep-nonexistent"], "some-draft", tmpDir),
    ).resolves.toBeUndefined();

    const unclustered = await listUnclustered(tmpDir);
    expect(unclustered).toHaveLength(1);
  });

  test("can mark multiple ids at once", async () => {
    const ep1 = makeEpisode({ id: "ep-multi111aaa" });
    const ep2 = makeEpisode({ id: "ep-multi222bbb", goal: "Second" });
    const ep3 = makeEpisode({ id: "ep-multi333ccc", goal: "Third" });
    await appendEpisodes([ep1, ep2, ep3], tmpDir);

    await markClustered(["ep-multi111aaa", "ep-multi222bbb"], "skill-batch", tmpDir);

    const unclustered = await listUnclustered(tmpDir);
    expect(unclustered).toHaveLength(1);
    expect(unclustered[0]?.id).toBe("ep-multi333ccc");
  });
});
