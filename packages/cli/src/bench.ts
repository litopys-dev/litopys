import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  type BenchReport,
  formatReportMarkdown,
  loadDataset,
  runBenchmark,
} from "@litopys/bench";

export async function cmdBench(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  const dataset = await loadDataset(opts.dataset);
  const report = await runBenchmark(dataset, {
    provider: opts.provider,
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });

  await writeReport(report, opts.output);
  process.stdout.write(formatReportMarkdown(report));
}

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  dataset: string;
  output: string;
  limit?: number;
  provider: string;
}

function parseArgs(args: string[]): ParsedArgs {
  let dataset = "synthetic";
  let output = path.resolve(process.cwd(), "bench-report.json");
  let limit: number | undefined;
  let provider = "mock";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dataset") {
      const next = args[++i];
      if (!next) throw new Error("--dataset requires a value");
      dataset = next;
    } else if (a === "--output") {
      const next = args[++i];
      if (!next) throw new Error("--output requires a value");
      output = path.resolve(process.cwd(), next);
    } else if (a === "--limit") {
      const next = args[++i];
      if (!next) throw new Error("--limit requires a value");
      const n = Number.parseInt(next, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--limit must be a positive integer, got "${next}"`);
      }
      limit = n;
    } else if (a === "--provider") {
      const next = args[++i];
      if (!next) throw new Error("--provider requires a value");
      provider = next;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  const parsed: ParsedArgs = { dataset, output, provider };
  if (limit !== undefined) parsed.limit = limit;
  return parsed;
}

async function writeReport(report: BenchReport, output: string): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}

function printHelp(): void {
  process.stdout.write(
    `litopys bench [options]

Runs the benchmark harness against Litopys's graph memory and prints a
markdown summary while writing a JSON report to disk.

Options:
  --dataset <name|path>   Built-in dataset name (default: synthetic) or path to a JSON file.
  --output <path>         JSON report destination (default: ./bench-report.json).
  --limit <N>             Only evaluate the first N questions (smoke runs).
  --provider <name>       Extractor provider (default: mock). Other valid values:
                          anthropic, openai, ollama — these require API keys.
`,
  );
}
