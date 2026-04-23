import { type AnyNode, type Edge, loadGraph, resolveGraph } from "@litopys/core";

interface ExportOptions {
  pretty: boolean;
  includeBodies: boolean;
  nowIso: string;
}

interface ExportPayload {
  meta: {
    exportedAt: string;
    nodeCount: number;
    edgeCount: number;
    schemaVersion: 1;
  };
  nodes: AnyNode[];
  edges: Edge[];
}

function parseArgs(args: string[]): Omit<ExportOptions, "nowIso"> {
  const opts = { pretty: false, includeBodies: true };
  for (const arg of args) {
    if (arg === "--pretty") {
      opts.pretty = true;
    } else if (arg === "--no-body") {
      opts.includeBodies = false;
    } else {
      process.stderr.write(`Unknown export flag: ${arg}\n`);
      process.exit(1);
    }
  }
  return opts;
}

function sortedNodes(nodes: Map<string, AnyNode>): AnyNode[] {
  return Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function sortedEdges(edges: Edge[]): Edge[] {
  return [...edges].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.relation !== b.relation) return a.relation.localeCompare(b.relation);
    return a.to.localeCompare(b.to);
  });
}

export async function buildExportPayload(
  graphPath: string,
  opts: ExportOptions,
): Promise<ExportPayload> {
  const loaded = await loadGraph(graphPath);
  const resolved = resolveGraph(loaded);

  const nodes = sortedNodes(loaded.nodes).map((n) =>
    opts.includeBodies ? n : { ...n, body: undefined },
  );

  return {
    meta: {
      exportedAt: opts.nowIso,
      nodeCount: loaded.nodes.size,
      edgeCount: resolved.edges.length,
      schemaVersion: 1,
    },
    nodes,
    edges: sortedEdges(resolved.edges),
  };
}

export async function cmdExport(args: string[], graphPath: string): Promise<void> {
  const parsed = parseArgs(args);
  const payload = await buildExportPayload(graphPath, {
    ...parsed,
    nowIso: new Date().toISOString(),
  });

  const indent = parsed.pretty ? 2 : 0;
  process.stdout.write(`${JSON.stringify(payload, null, indent)}\n`);
}
