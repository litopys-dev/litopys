import { type GraphError, loadGraph, resolveGraph } from "@litopys/core";

interface CheckOptions {
  json: boolean;
}

function parseArgs(args: string[]): CheckOptions {
  const opts: CheckOptions = { json: false };
  for (const arg of args) {
    if (arg === "--json") {
      opts.json = true;
    } else {
      process.stderr.write(`Unknown check flag: ${arg}\n`);
      process.exit(1);
    }
  }
  return opts;
}

function formatError(err: GraphError): string {
  const locator = err.id ? `${err.id} (${err.file || "?"})` : err.file || "?";
  return `  [${err.kind}] ${locator}: ${err.message}`;
}

export async function cmdCheck(args: string[], graphPath: string): Promise<void> {
  const opts = parseArgs(args);

  const loaded = await loadGraph(graphPath);
  const resolved = resolveGraph(loaded);
  const errors = resolved.errors;
  const nodeCount = loaded.nodes.size;
  const edgeCount = resolved.edges.length;

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ nodeCount, edgeCount, errorCount: errors.length, errors }, null, 2)}\n`,
    );
    if (errors.length > 0) process.exit(1);
    return;
  }

  process.stdout.write(`Scanned ${nodeCount} node(s), ${edgeCount} edge(s) in ${graphPath}\n`);

  if (errors.length === 0) {
    process.stdout.write("OK — no integrity issues.\n");
    return;
  }

  const byKind = new Map<string, GraphError[]>();
  for (const err of errors) {
    const bucket = byKind.get(err.kind) ?? [];
    bucket.push(err);
    byKind.set(err.kind, bucket);
  }

  process.stdout.write(`\nFound ${errors.length} issue(s):\n`);
  for (const [kind, bucket] of byKind) {
    process.stdout.write(`\n${kind} (${bucket.length}):\n`);
    for (const err of bucket) {
      process.stdout.write(`${formatError(err)}\n`);
    }
  }

  process.exit(1);
}
