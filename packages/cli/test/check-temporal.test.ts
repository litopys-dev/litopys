import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadGraph, writeNode } from "@litopys/core";
import { migrateTemporal } from "../src/check.ts";

describe("migrateTemporal (--fix-temporal)", () => {
  let tmpDir: string;
  let graphDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-fix-temporal-"));
    graphDir = path.join(tmpDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("backfills occurred_at = updated for non-event nodes", async () => {
    await writeNode(graphDir, {
      id: "plain-system",
      type: "system",
      updated: "2026-03-15",
      confidence: 0.9,
      body: "",
    });

    const result = await migrateTemporal(graphDir, { dryRun: false });
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]?.occurred_at).toBe("2026-03-15");
    expect(result.planned[0]?.source).toBe("updated");
    expect(result.applied).toBe(1);

    const reloaded = await loadGraph(graphDir);
    expect(reloaded.nodes.get("plain-system")?.occurred_at).toBe("2026-03-15");
  });

  test("uses id-prefix date for event nodes", async () => {
    await writeNode(graphDir, {
      id: "2026-04-22-deploy",
      type: "event",
      updated: "2026-04-25",
      confidence: 1,
      body: "",
    });

    const result = await migrateTemporal(graphDir, { dryRun: false });
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]?.occurred_at).toBe("2026-04-22");
    expect(result.planned[0]?.source).toBe("id-prefix");
  });

  test("non-date-prefixed event falls back to updated", async () => {
    await writeNode(graphDir, {
      id: "some-event",
      type: "event",
      updated: "2026-04-25",
      confidence: 1,
      body: "",
    });

    const result = await migrateTemporal(graphDir, { dryRun: false });
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]?.occurred_at).toBe("2026-04-25");
    expect(result.planned[0]?.source).toBe("updated");
  });

  test("idempotent: nodes with occurred_at already set are skipped", async () => {
    await writeNode(graphDir, {
      id: "already-set",
      type: "system",
      updated: "2026-04-25",
      confidence: 1,
      occurred_at: "2024-01-01",
      body: "",
    });

    const first = await migrateTemporal(graphDir, { dryRun: false });
    expect(first.planned).toHaveLength(0);
    expect(first.skipped).toBe(1);

    // Running twice: still skipped, value preserved.
    const second = await migrateTemporal(graphDir, { dryRun: false });
    expect(second.planned).toHaveLength(0);
    expect(second.skipped).toBe(1);

    const reloaded = await loadGraph(graphDir);
    expect(reloaded.nodes.get("already-set")?.occurred_at).toBe("2024-01-01");
  });

  test("--dry-run plans but does not write", async () => {
    await writeNode(graphDir, {
      id: "dry-system",
      type: "system",
      updated: "2026-03-15",
      confidence: 0.9,
      body: "",
    });

    const result = await migrateTemporal(graphDir, { dryRun: true });
    expect(result.planned).toHaveLength(1);
    expect(result.applied).toBe(0);

    const reloaded = await loadGraph(graphDir);
    expect(reloaded.nodes.get("dry-system")?.occurred_at).toBeUndefined();
  });
});
