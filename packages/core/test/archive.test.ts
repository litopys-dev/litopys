import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { archiveTombstoned, writeNode } from "../src/index.ts";

describe("archiveTombstoned", () => {
  let tmpDir: string;
  let graphDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-archive-"));
    graphDir = path.join(tmpDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("dry-run lists tombstoned-and-old nodes without moving them", async () => {
    await writeNode(graphDir, {
      id: "old-system",
      type: "system",
      updated: "2024-01-01",
      confidence: 0.9,
      until: "2024-06-01",
      body: "",
    });

    const result = await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 365,
      dryRun: true,
    });

    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]?.id).toBe("old-system");
    expect(result.planned[0]?.originalPath).toBe(path.join("systems", "old-system.md"));
    expect(result.planned[0]?.archivePath).toBe(path.join("archive", "systems", "old-system.md"));
    expect(result.planned[0]?.until).toBe("2024-06-01");
    expect(result.archived).toBe(0);

    // File still in place.
    const stillThere = await fs
      .stat(path.join(graphDir, "systems", "old-system.md"))
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(true);
  });

  test("moves tombstoned-and-old node, preserves subdirectory, writes manifest", async () => {
    await writeNode(graphDir, {
      id: "old-system",
      type: "system",
      updated: "2024-01-01",
      confidence: 0.9,
      until: "2024-06-01",
      body: "",
    });

    const result = await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 365,
      dryRun: false,
    });

    expect(result.planned).toHaveLength(1);
    expect(result.archived).toBe(1);

    const origGone = await fs
      .stat(path.join(graphDir, "systems", "old-system.md"))
      .then(() => true)
      .catch(() => false);
    expect(origGone).toBe(false);

    const movedThere = await fs
      .stat(path.join(graphDir, "archive", "systems", "old-system.md"))
      .then(() => true)
      .catch(() => false);
    expect(movedThere).toBe(true);

    const manifest = await fs.readFile(path.join(graphDir, "archive", "manifest.jsonl"), "utf-8");
    const lines = manifest.trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string);
    expect(entry.id).toBe("old-system");
    expect(entry.original_path).toBe(path.join("systems", "old-system.md"));
    expect(entry.until).toBe("2024-06-01");
    expect(typeof entry.archived_at).toBe("string");
  });

  test("leaves alive (no until) and recently-tombstoned nodes alone", async () => {
    await writeNode(graphDir, {
      id: "alive",
      type: "system",
      updated: "2026-05-01",
      confidence: 1,
      body: "",
    });
    await writeNode(graphDir, {
      id: "recent",
      type: "system",
      updated: "2026-04-01",
      confidence: 0.8,
      until: "2026-04-15",
      body: "",
    });

    const result = await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 365,
      dryRun: false,
    });

    expect(result.planned).toHaveLength(0);
    expect(result.archived).toBe(0);
    expect(result.scanned).toBe(2);
  });

  test("boundary: until exactly equal to cutoff is NOT archived (>= cutoff stays)", async () => {
    // today 2026-05-16, olderThan 365 -> cutoff 2025-05-16
    // until = 2025-05-16 (exactly cutoff) — should NOT be archived.
    await writeNode(graphDir, {
      id: "edge",
      type: "system",
      updated: "2025-01-01",
      confidence: 1,
      until: "2025-05-16",
      body: "",
    });
    // until = 2025-05-15 (one day before) — SHOULD be archived.
    await writeNode(graphDir, {
      id: "past",
      type: "system",
      updated: "2025-01-01",
      confidence: 1,
      until: "2025-05-15",
      body: "",
    });

    const result = await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 365,
      dryRun: false,
    });

    expect(result.planned.map((p) => p.id).sort()).toEqual(["past"]);
  });

  test("idempotent: a second run is a no-op", async () => {
    await writeNode(graphDir, {
      id: "old-system",
      type: "system",
      updated: "2024-01-01",
      confidence: 0.9,
      until: "2024-06-01",
      body: "",
    });

    const first = await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 365,
      dryRun: false,
    });
    expect(first.archived).toBe(1);

    const second = await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 365,
      dryRun: false,
    });
    expect(second.planned).toHaveLength(0);
    expect(second.archived).toBe(0);

    // Manifest still has exactly one entry.
    const manifest = await fs.readFile(path.join(graphDir, "archive", "manifest.jsonl"), "utf-8");
    expect(manifest.trim().split("\n")).toHaveLength(1);
  });

  test("manifest is append-only across separate runs", async () => {
    await writeNode(graphDir, {
      id: "first",
      type: "system",
      updated: "2024-01-01",
      confidence: 1,
      until: "2024-02-01",
      body: "",
    });
    await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 365,
      dryRun: false,
    });

    await writeNode(graphDir, {
      id: "second",
      type: "system",
      updated: "2024-03-01",
      confidence: 1,
      until: "2024-04-01",
      body: "",
    });
    await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 365,
      dryRun: false,
    });

    const manifest = await fs.readFile(path.join(graphDir, "archive", "manifest.jsonl"), "utf-8");
    const ids = manifest
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["first", "second"]);
  });

  test("rejects bad today string", async () => {
    await expect(
      archiveTombstoned(graphDir, { today: "not-a-date", olderThan: 1, dryRun: true }),
    ).rejects.toThrow(/today must be ISO date/);
  });

  test("rejects negative olderThan", async () => {
    await expect(
      archiveTombstoned(graphDir, { today: "2026-05-16", olderThan: -1, dryRun: true }),
    ).rejects.toThrow(/olderThan/);
  });

  test("olderThan=0 archives everything that is already tombstoned in the past", async () => {
    await writeNode(graphDir, {
      id: "yesterday",
      type: "system",
      updated: "2026-05-10",
      confidence: 1,
      until: "2026-05-15",
      body: "",
    });
    const result = await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 0,
      dryRun: false,
    });
    expect(result.archived).toBe(1);
  });

  test("does not re-scan files already under archive/", async () => {
    await writeNode(graphDir, {
      id: "alive",
      type: "system",
      updated: "2026-05-01",
      confidence: 1,
      body: "",
    });

    // Pre-seed archive/ with a node-shaped file that has `until`.
    await fs.mkdir(path.join(graphDir, "archive", "systems"), { recursive: true });
    await fs.writeFile(
      path.join(graphDir, "archive", "systems", "previously-archived.md"),
      `---
id: previously-archived
type: system
updated: "2024-01-01"
confidence: 0.9
until: "2024-06-01"
---
`,
      "utf-8",
    );

    const result = await archiveTombstoned(graphDir, {
      today: "2026-05-16",
      olderThan: 365,
      dryRun: false,
    });
    expect(result.planned).toHaveLength(0);
    expect(result.archived).toBe(0);
    // Scanned does NOT count the archived file.
    expect(result.scanned).toBe(1);
  });
});
