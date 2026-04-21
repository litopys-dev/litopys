/**
 * `litopys similar <id> [--explain]` — deterministic merge-candidate search.
 */

import { findSimilar, loadGraph } from "@litopys/core";

export interface SimilarOptions {
  explain: boolean;
  limit: number;
  minScore: number;
}

export function parseSimilarArgs(args: string[]): { id: string; opts: SimilarOptions } {
  let id: string | undefined;
  const opts: SimilarOptions = { explain: false, limit: 10, minScore: 0.35 };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--explain") {
      opts.explain = true;
    } else if (a === "--limit") {
      const val = args[++i];
      if (val === undefined) throw new Error("--limit requires a number");
      const n = Number.parseInt(val, 10);
      if (Number.isNaN(n) || n <= 0) throw new Error(`Invalid --limit: ${val}`);
      opts.limit = n;
    } else if (a === "--min-score") {
      const val = args[++i];
      if (val === undefined) throw new Error("--min-score requires a number");
      const n = Number.parseFloat(val);
      if (Number.isNaN(n) || n < 0 || n > 1) throw new Error(`Invalid --min-score: ${val}`);
      opts.minScore = n;
    } else if (a && !a.startsWith("--")) {
      if (id !== undefined) throw new Error(`Unexpected extra arg: ${a}`);
      id = a;
    } else {
      throw new Error(`Unknown flag: ${a}`);
    }
  }

  if (!id) throw new Error("Usage: similar <id> [--explain] [--limit N] [--min-score F]");
  return { id, opts };
}

export async function cmdSimilar(args: string[], graphDir: string): Promise<void> {
  const { id, opts } = parseSimilarArgs(args);

  const graph = await loadGraph(graphDir);
  const target = graph.nodes.get(id);
  if (!target) {
    process.stderr.write(`Node not found: "${id}"\n`);
    process.exit(1);
  }

  const results = findSimilar(target, graph.nodes.values(), {
    limit: opts.limit,
    minScore: opts.minScore,
  });

  if (results.length === 0) {
    process.stdout.write(
      `No similar nodes found for "${id}" (min-score ${opts.minScore}, limit ${opts.limit}).\n`,
    );
    return;
  }

  process.stdout.write(`Merge candidates for "${id}" (${results.length}):\n\n`);
  for (const r of results) {
    const summaryPart = r.node.summary ? ` — ${r.node.summary}` : "";
    process.stdout.write(
      `  [${r.score.toFixed(3)}] ${r.node.id}  (${r.node.type})${summaryPart}\n`,
    );
    if (opts.explain) {
      for (const reason of r.reasons) {
        const weightPart = reason.weight > 0 ? `  [+${reason.weight.toFixed(3)}]` : "";
        process.stdout.write(`          · ${reason.kind}: ${reason.detail}${weightPart}\n`);
      }
      process.stdout.write("\n");
    }
  }
}
