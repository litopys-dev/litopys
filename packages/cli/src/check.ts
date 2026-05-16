import {
  type AnyNode,
  type GraphError,
  eventDateFromId,
  loadGraph,
  resolveGraph,
  writeNode,
} from "@litopys/core";

interface CheckOptions {
  json: boolean;
  fixTemporal: boolean;
  dryRun: boolean;
}

function parseArgs(args: string[]): CheckOptions {
  const opts: CheckOptions = { json: false, fixTemporal: false, dryRun: false };
  for (const arg of args) {
    if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--fix-temporal") {
      opts.fixTemporal = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else {
      process.stderr.write(`Unknown check flag: ${arg}\n`);
      process.exit(1);
    }
  }
  return opts;
}

export interface TemporalMigrationPlanItem {
  id: string;
  type: string;
  occurred_at: string;
  source: "id-prefix" | "updated";
}

export interface TemporalMigrationResult {
  planned: TemporalMigrationPlanItem[];
  applied: number;
  skipped: number;
}

/**
 * Bi-temporal migration: set `occurred_at` on every node that lacks it.
 *
 * Rules:
 *   - Event nodes whose id is date-prefixed (e.g. "2026-04-22-incident") get
 *     occurred_at = that date prefix.
 *   - Every other node lacking occurred_at gets occurred_at = updated.
 *   - Nodes that already have occurred_at are left untouched (idempotent).
 */
export async function migrateTemporal(
  graphPath: string,
  opts: { dryRun: boolean },
): Promise<TemporalMigrationResult> {
  const loaded = await loadGraph(graphPath);
  const planned: TemporalMigrationPlanItem[] = [];
  let applied = 0;
  let skipped = 0;

  for (const [, node] of loaded.nodes) {
    if (node.occurred_at) {
      skipped++;
      continue;
    }
    let occurredAt: string;
    let source: "id-prefix" | "updated";
    const idDate = node.type === "event" ? eventDateFromId(node.id) : undefined;
    if (idDate) {
      occurredAt = idDate;
      source = "id-prefix";
    } else {
      occurredAt = node.updated;
      source = "updated";
    }
    planned.push({ id: node.id, type: node.type, occurred_at: occurredAt, source });

    if (!opts.dryRun) {
      const updated: AnyNode = { ...node, occurred_at: occurredAt } as AnyNode;
      await writeNode(graphPath, updated);
      applied++;
    }
  }

  return { planned, applied, skipped };
}

function formatError(err: GraphError): string {
  const locator = err.id ? `${err.id} (${err.file || "?"})` : err.file || "?";
  return `  [${err.kind}] ${locator}: ${err.message}`;
}

export async function cmdCheck(args: string[], graphPath: string): Promise<void> {
  const opts = parseArgs(args);

  if (opts.fixTemporal) {
    const result = await migrateTemporal(graphPath, { dryRun: opts.dryRun });
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const verb = opts.dryRun ? "Would update" : "Updated";
    process.stdout.write(
      `${verb} ${result.planned.length} node(s) (skipped ${result.skipped} already-set)\n`,
    );
    for (const item of result.planned.slice(0, 20)) {
      process.stdout.write(
        `  ${item.id} (${item.type}) -> occurred_at=${item.occurred_at} (from ${item.source})\n`,
      );
    }
    if (result.planned.length > 20) {
      process.stdout.write(`  ... and ${result.planned.length - 20} more\n`);
    }
    return;
  }

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
