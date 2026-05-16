import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AnyNode, RelationName } from "@litopys/core";
import { loadGraph, writeNode } from "@litopys/core";
import {
  type AdapterName,
  type CandidateNode,
  type CandidateRelation,
  type ExtractorAdapter,
  createAdapter,
} from "@litopys/extractor";
import { type SearchHit, toolRelated, toolSearch } from "@litopys/mcp";
import type { BenchDataset, BenchSession } from "./dataset.ts";
import { mean, precisionAtK, recallAtK } from "./scoring.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HarnessOptions {
  /** Adapter to use; defaults to the deterministic "mock" extractor. */
  provider?: AdapterName | string;
  /** Pre-built adapter; takes precedence over `provider`. */
  adapter?: ExtractorAdapter;
  /** Limit the number of questions evaluated (smoke runs). */
  limit?: number;
  /** k for recall@k / precision@k. Default 5. */
  k?: number;
  /** Directory to use for the isolated graph. Default: an os.tmpdir() subdir. */
  graphDir?: string;
  /** When true, leave the temp graph on disk after the run for inspection. */
  keepGraphDir?: boolean;
}

export interface PerQuestionResult {
  q_id: string;
  query: string;
  expected_node_ids: string[];
  retrieved_ids: string[];
  recall_at_k: number;
  precision_at_k: number;
  latency_ms: number;
}

export interface BenchReport {
  dataset: string;
  total_questions: number;
  k: number;
  provider: string;
  summary: {
    recall_at_k: number;
    precision_at_k: number;
    mean_latency_ms: number;
  };
  per_question: PerQuestionResult[];
}

// ---------------------------------------------------------------------------
// Harness entry point
// ---------------------------------------------------------------------------

export async function runBenchmark(
  dataset: BenchDataset,
  opts: HarnessOptions = {},
): Promise<BenchReport> {
  const k = opts.k ?? 5;
  const provider = opts.adapter?.name ?? opts.provider ?? "mock";
  const adapter = opts.adapter ?? createAdapter(provider);
  const graphDir = opts.graphDir ?? (await createIsolatedGraphDir());

  let report: BenchReport;
  try {
    await ingestSessions(dataset.sessions, adapter, graphDir);
    const questions = opts.limit !== undefined ? dataset.questions.slice(0, opts.limit) : dataset.questions;
    const per: PerQuestionResult[] = [];
    for (const q of questions) {
      const start = performance.now();
      const search = await toolSearch({ query: q.query, limit: Math.max(k, 5) }, graphDir);
      const hits: SearchHit[] = search.ok ? search.data : [];
      // Expand with one hop of `related` from the top hit — mirrors how a
      // real Litopys consumer would look up neighbours. For empty hits this
      // is a no-op.
      const neighbours = new Set<string>();
      if (hits[0]) {
        const rel = await toolRelated(
          { id: hits[0].id, depth: 1, direction: "both" },
          graphDir,
        );
        if (rel.ok) {
          for (const n of rel.data.nodes) neighbours.add(n.id);
        }
      }
      const latency_ms = Math.round((performance.now() - start) * 100) / 100;

      const ordered: string[] = [];
      const seen = new Set<string>();
      for (const h of hits) {
        if (!seen.has(h.id)) {
          ordered.push(h.id);
          seen.add(h.id);
        }
      }
      for (const id of neighbours) {
        if (!seen.has(id)) {
          ordered.push(id);
          seen.add(id);
        }
      }

      per.push({
        q_id: q.id,
        query: q.query,
        expected_node_ids: q.expected_node_ids,
        retrieved_ids: ordered.slice(0, k),
        recall_at_k: recallAtK(ordered, q.expected_node_ids, k),
        precision_at_k: precisionAtK(ordered, q.expected_node_ids, k),
        latency_ms,
      });
    }

    report = {
      dataset: dataset.name ?? "unnamed",
      total_questions: per.length,
      k,
      provider,
      summary: {
        recall_at_k: round4(mean(per.map((r) => r.recall_at_k))),
        precision_at_k: round4(mean(per.map((r) => r.precision_at_k))),
        mean_latency_ms: round4(mean(per.map((r) => r.latency_ms))),
      },
      per_question: per,
    };
  } finally {
    if (!opts.keepGraphDir && !opts.graphDir) {
      await fs.rm(graphDir, { recursive: true, force: true });
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

export function formatReportMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push(`# Litopys benchmark — ${report.dataset}`);
  lines.push("");
  lines.push(`Provider: ${report.provider}`);
  lines.push(`Total questions: ${report.total_questions}`);
  lines.push(`Recall@${report.k}: ${report.summary.recall_at_k.toFixed(4)}`);
  lines.push(`Precision@${report.k}: ${report.summary.precision_at_k.toFixed(4)}`);
  lines.push(`Mean latency: ${report.summary.mean_latency_ms.toFixed(2)}ms`);
  lines.push("");
  lines.push(`| q_id | recall@${report.k} | precision@${report.k} | latency_ms |`);
  lines.push("|------|----------|-------------|------------|");
  for (const r of report.per_question) {
    lines.push(
      `| ${r.q_id} | ${r.recall_at_k.toFixed(2)} | ${r.precision_at_k.toFixed(2)} | ${r.latency_ms.toFixed(2)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

export async function createIsolatedGraphDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-bench-"));
  await fs.mkdir(path.join(dir, "graph"), { recursive: true });
  // Seed each type-directory so loadGraph doesn't choke on a fresh path.
  for (const t of ["people", "projects", "systems", "concepts", "events", "lessons"]) {
    await fs.mkdir(path.join(dir, "graph", t), { recursive: true });
  }
  return path.join(dir, "graph");
}

async function ingestSessions(
  sessions: BenchSession[],
  adapter: ExtractorAdapter,
  graphDir: string,
): Promise<void> {
  const existingIds = new Set<string>();
  for (const session of sessions) {
    const transcript = sessionToTranscript(session);
    const out = await adapter.extract({
      transcript,
      existingNodeIds: Array.from(existingIds),
    });
    for (const candidate of out.candidateNodes) {
      if (existingIds.has(candidate.id)) continue;
      await persistCandidate(candidate, graphDir);
      existingIds.add(candidate.id);
    }
    if (out.candidateRelations.length > 0) {
      await applyRelations(out.candidateRelations, existingIds, graphDir);
    }
  }
}

function sessionToTranscript(session: BenchSession): string {
  return session.messages.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
}

async function persistCandidate(c: CandidateNode, graphDir: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const raw: Record<string, unknown> = {
    id: c.id,
    type: c.type,
    summary: c.summary,
    updated: today,
    confidence: c.confidence,
  };
  if (c.aliases !== undefined) raw.aliases = c.aliases;
  if (c.tags !== undefined) raw.tags = c.tags;
  if (c.body !== undefined) raw.body = c.body;
  await writeNode(graphDir, raw as unknown as AnyNode);
}

async function applyRelations(
  relations: CandidateRelation[],
  knownIds: Set<string>,
  graphDir: string,
): Promise<void> {
  // Re-read the graph once, apply all relations in memory, then write back.
  const loaded = await loadGraph(graphDir);
  const touched = new Map<string, AnyNode>();
  for (const r of relations) {
    if (!knownIds.has(r.sourceId) || !knownIds.has(r.targetId)) continue;
    const sourceNode = touched.get(r.sourceId) ?? loaded.nodes.get(r.sourceId);
    if (!sourceNode) continue;
    const newRels: Record<RelationName, string[]> = {
      ...((sourceNode.rels ?? {}) as Record<RelationName, string[]>),
    };
    const list = newRels[r.type] ?? [];
    if (!list.includes(r.targetId)) {
      list.push(r.targetId);
      newRels[r.type] = list;
    }
    touched.set(r.sourceId, { ...sourceNode, rels: newRels } as AnyNode);
  }
  for (const node of touched.values()) {
    await writeNode(graphDir, node);
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
