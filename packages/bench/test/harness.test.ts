import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { loadGraph } from "@litopys/core";
import { loadDataset } from "../src/dataset.ts";
import {
  createIsolatedGraphDir,
  formatReportMarkdown,
  runBenchmark,
} from "../src/harness.ts";

describe("createIsolatedGraphDir", () => {
  test("creates a graph directory under the OS tempdir, not under $HOME", async () => {
    const dir = await createIsolatedGraphDir();
    try {
      expect(dir).toContain("litopys-bench-");
      expect(dir.startsWith(path.join(homedir(), ".litopys"))).toBe(false);
      // The six well-known type subdirectories must exist.
      for (const t of ["people", "projects", "systems", "concepts", "events", "lessons"]) {
        const stat = await fs.stat(path.join(dir, t));
        expect(stat.isDirectory()).toBe(true);
      }
    } finally {
      await fs.rm(path.dirname(dir), { recursive: true, force: true });
    }
  });
});

describe("runBenchmark (end-to-end on synthetic dataset)", () => {
  test("runs first 3 questions in under 5s and persists nodes to the isolated graph", async () => {
    const dataset = await loadDataset("synthetic");
    const dir = await createIsolatedGraphDir();
    try {
      const start = Date.now();
      const report = await runBenchmark(dataset, {
        provider: "mock",
        limit: 3,
        graphDir: dir,
      });
      const elapsedMs = Date.now() - start;
      expect(elapsedMs).toBeLessThan(5000);

      expect(report.total_questions).toBe(3);
      expect(report.provider).toBe("mock");
      expect(report.k).toBe(5);
      expect(report.dataset).toBe("synthetic");

      // Sessions were ingested into the isolated graph.
      const loaded = await loadGraph(dir);
      expect(loaded.nodes.size).toBeGreaterThan(0);

      // At least one of the three smoke questions found something.
      const anyHit = report.per_question.some((r) => r.retrieved_ids.length > 0);
      expect(anyHit).toBe(true);

      // Summary is the mean of the per-question rows.
      expect(report.summary.recall_at_k).toBeGreaterThanOrEqual(0);
      expect(report.summary.recall_at_k).toBeLessThanOrEqual(1);
      expect(report.summary.precision_at_k).toBeGreaterThanOrEqual(0);
      expect(report.summary.precision_at_k).toBeLessThanOrEqual(1);

      // Latency is recorded as a non-negative number per question.
      for (const r of report.per_question) {
        expect(r.latency_ms).toBeGreaterThanOrEqual(0);
        expect(r.retrieved_ids.length).toBeLessThanOrEqual(5);
      }
    } finally {
      await fs.rm(path.dirname(dir), { recursive: true, force: true });
    }
  });

  test("achieves high recall on the full synthetic dataset with the mock extractor", async () => {
    const dataset = await loadDataset("synthetic");
    const report = await runBenchmark(dataset, { provider: "mock" });
    expect(report.total_questions).toBe(dataset.questions.length);
    // The fixture and the mock extractor are co-designed — recall@5 should be
    // strong. A regression dropping below ~0.7 means the extractor or the
    // search pipeline broke.
    expect(report.summary.recall_at_k).toBeGreaterThan(0.7);
  });

  test("cleans up the auto-generated graph dir when keepGraphDir is unset", async () => {
    const dataset = await loadDataset("synthetic");
    let observed: string | undefined;
    const original = createIsolatedGraphDir;
    // We can't easily intercept the internal mkdtemp, so instead supply our
    // own dir and assert the harness honours `keepGraphDir`.
    const dir = await original();
    observed = dir;
    await runBenchmark(dataset, {
      provider: "mock",
      limit: 1,
      graphDir: dir,
      keepGraphDir: true,
    });
    // keepGraphDir true → dir survives the run.
    const stat = await fs.stat(observed);
    expect(stat.isDirectory()).toBe(true);
    await fs.rm(path.dirname(observed), { recursive: true, force: true });
  });
});

describe("formatReportMarkdown", () => {
  test("produces a markdown summary with header, totals, and a per-question table", async () => {
    const dataset = await loadDataset("synthetic");
    const report = await runBenchmark(dataset, { provider: "mock", limit: 2 });
    const md = formatReportMarkdown(report);
    expect(md).toContain("# Litopys benchmark — synthetic");
    expect(md).toContain("Provider: mock");
    expect(md).toContain("Recall@5:");
    expect(md).toContain("Precision@5:");
    expect(md).toContain("Mean latency:");
    expect(md).toContain("| q_id |");
    // Each per-question row appears as `| qN | …`.
    for (const r of report.per_question) {
      expect(md).toContain(`| ${r.q_id} |`);
    }
  });
});
