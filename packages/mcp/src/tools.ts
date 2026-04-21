import {
  type AnyNode,
  type Edge,
  type NodeType,
  NodeType as NodeTypeEnum,
  type RelationName,
  RelationName as RelationNameEnum,
  defaultGraphPath,
  loadGraph,
  resolveGraph,
  writeNode,
} from "@litopys/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Graph path
// ---------------------------------------------------------------------------

export function graphPath(): string {
  return defaultGraphPath();
}

// ---------------------------------------------------------------------------
// Input schemas (zod v4)
// ---------------------------------------------------------------------------

export const SearchInputSchema = z.object({
  query: z.string().min(1).describe("Keyword query to search in the graph"),
  types: z
    .array(z.enum(NodeTypeEnum.options))
    .optional()
    .describe("Filter results to specific node types"),
  limit: z.number().int().min(1).max(100).default(20).describe("Max results to return"),
});

export const GetInputSchema = z.object({
  id: z.string().min(1).describe("Node id or alias to look up"),
  include_edges: z.boolean().default(true).describe("Include incident edges in the response"),
});

export const CreateInputSchema = z.object({
  type: z.enum(NodeTypeEnum.options).describe("Node type"),
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be lowercase kebab-case")
    .describe("Unique node id (kebab-case)"),
  name: z.string().min(1).describe("Human-readable name (stored in summary field)"),
  aliases: z.array(z.string()).optional().describe("Alternative names"),
  body: z.string().optional().describe("Markdown body content"),
  tags: z.array(z.string()).optional().describe("Tags"),
  relations: z
    .array(
      z.object({
        type: z.enum(RelationNameEnum.options),
        target: z.string().min(1),
      }),
    )
    .optional()
    .describe("Relations to other nodes"),
});

export const LinkInputSchema = z.object({
  relation_type: z.enum(RelationNameEnum.options).describe("Relation type"),
  source_id: z.string().min(1).describe("Source node id"),
  target_id: z.string().min(1).describe("Target node id"),
});

export const RelatedInputSchema = z.object({
  id: z.string().min(1).describe("Starting node id or alias"),
  relation_type: z.enum(RelationNameEnum.options).optional().describe("Filter by relation type"),
  depth: z.number().int().min(1).max(5).default(1).describe("BFS traversal depth (1–5)"),
  direction: z.enum(["out", "in", "both"]).default("both").describe("Edge direction to follow"),
});

// ---------------------------------------------------------------------------
// Search result types
// ---------------------------------------------------------------------------

export interface SearchHit {
  id: string;
  type: NodeType;
  name: string;
  snippet: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

function scoreNode(node: AnyNode, queryWords: string[]): number {
  let score = 0;
  const name = normalize(node.summary ?? node.id);
  for (const word of queryWords) {
    if (name === word) score += 10;
    else if (name.includes(word)) score += 5;
  }
  for (const alias of node.aliases ?? []) {
    const a = normalize(alias);
    for (const word of queryWords) {
      if (a === word) score += 5;
      else if (a.includes(word)) score += 3;
    }
  }
  if (node.body) {
    const body = normalize(node.body);
    for (const word of queryWords) {
      let idx = body.indexOf(word);
      while (idx !== -1) {
        score += 1;
        idx = body.indexOf(word, idx + 1);
      }
    }
  }
  for (const tag of node.tags ?? []) {
    const t = normalize(tag);
    for (const word of queryWords) {
      if (t.includes(word)) score += 2;
    }
  }
  return score;
}

function nodeSnippet(node: AnyNode): string {
  if (node.summary) return node.summary;
  if (node.body) return node.body.slice(0, 120).replace(/\n/g, " ").trim();
  return "";
}

function resolveId(nodes: Map<string, AnyNode>, idOrAlias: string): AnyNode | undefined {
  const direct = nodes.get(idOrAlias);
  if (direct) return direct;
  const lower = normalize(idOrAlias);
  for (const node of nodes.values()) {
    for (const alias of node.aliases ?? []) {
      if (normalize(alias) === lower) return node;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tool result types
// ---------------------------------------------------------------------------

export interface ToolOk<T> {
  ok: true;
  data: T;
}

export interface ToolErr {
  ok: false;
  error: string;
}

export type ToolResult<T> = ToolOk<T> | ToolErr;

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function toolSearch(
  input: z.infer<typeof SearchInputSchema>,
  dir: string,
): Promise<ToolResult<SearchHit[]>> {
  const loaded = await loadGraph(dir);
  const queryWords = normalize(input.query)
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const hits: SearchHit[] = [];
  for (const [, node] of loaded.nodes) {
    if (input.types && input.types.length > 0 && !input.types.includes(node.type)) {
      continue;
    }
    const score = scoreNode(node, queryWords);
    if (score > 0) {
      hits.push({
        id: node.id,
        type: node.type,
        name: node.summary ?? node.id,
        snippet: nodeSnippet(node),
        score,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return { ok: true, data: hits.slice(0, input.limit) };
}

export async function toolGet(
  input: z.infer<typeof GetInputSchema>,
  dir: string,
): Promise<ToolResult<{ node: AnyNode; incoming: Edge[]; outgoing: Edge[] }>> {
  const loaded = await loadGraph(dir);
  const node = resolveId(loaded.nodes, input.id);
  if (!node) {
    return { ok: false, error: `Node not found: "${input.id}"` };
  }

  if (!input.include_edges) {
    return { ok: true, data: { node, incoming: [], outgoing: [] } };
  }

  const resolved = resolveGraph(loaded);
  const incoming = resolved.edges.filter((e) => e.to === node.id);
  const outgoing = resolved.edges.filter((e) => e.from === node.id);

  return { ok: true, data: { node, incoming, outgoing } };
}

export async function toolCreate(
  input: z.infer<typeof CreateInputSchema>,
  dir: string,
): Promise<ToolResult<{ id: string; path: string }>> {
  const loaded = await loadGraph(dir);
  if (loaded.nodes.has(input.id)) {
    return { ok: false, error: `Node already exists: "${input.id}"` };
  }

  // Build rels from relations input
  const rels: Partial<Record<RelationName, string[]>> = {};
  for (const rel of input.relations ?? []) {
    const list = rels[rel.type] ?? [];
    list.push(rel.target);
    rels[rel.type] = list;
  }

  const today = new Date().toISOString().slice(0, 10);
  // Strip undefined fields — gray-matter can't serialize them
  const raw: Record<string, unknown> = {
    id: input.id,
    type: input.type,
    summary: input.name,
    updated: today,
    confidence: 1,
  };
  if (input.aliases !== undefined) raw.aliases = input.aliases;
  if (input.body !== undefined) raw.body = input.body;
  if (input.tags !== undefined) raw.tags = input.tags;
  if (Object.keys(rels).length > 0) raw.rels = rels;
  const node = raw as unknown as AnyNode;

  await writeNode(dir, node);

  const TYPE_DIR: Record<string, string> = {
    person: "people",
    project: "projects",
    system: "systems",
    concept: "concepts",
    event: "events",
    lesson: "lessons",
  };
  const path = `${dir}/${TYPE_DIR[input.type]}/${input.id}.md`;
  return { ok: true, data: { id: input.id, path } };
}

export async function toolLink(
  input: z.infer<typeof LinkInputSchema>,
  dir: string,
): Promise<ToolResult<{ source: string; target: string; relation: string }>> {
  const loaded = await loadGraph(dir);

  const sourceNode = loaded.nodes.get(input.source_id);
  if (!sourceNode) {
    return { ok: false, error: `Source node not found: "${input.source_id}"` };
  }

  const targetNode = loaded.nodes.get(input.target_id);
  if (!targetNode) {
    return {
      ok: false,
      error: `Target node not found: "${input.target_id}". Create it first with litopys_create.`,
    };
  }

  // Check if relation already exists
  const existing = sourceNode.rels?.[input.relation_type] ?? [];
  if (existing.includes(input.target_id)) {
    return {
      ok: true,
      data: { source: input.source_id, target: input.target_id, relation: input.relation_type },
    };
  }

  // Add relation
  const newRels: Record<RelationName, string[]> = {
    ...(sourceNode.rels ?? {}),
  } as Record<RelationName, string[]>;
  const list = newRels[input.relation_type] ?? [];
  list.push(input.target_id);
  newRels[input.relation_type] = list;

  const updated: AnyNode = {
    ...sourceNode,
    rels: newRels,
  } as AnyNode;

  await writeNode(dir, updated);

  return {
    ok: true,
    data: { source: input.source_id, target: input.target_id, relation: input.relation_type },
  };
}

export async function toolRelated(
  input: z.infer<typeof RelatedInputSchema>,
  dir: string,
): Promise<ToolResult<{ nodes: AnyNode[]; edges: Edge[] }>> {
  const loaded = await loadGraph(dir);
  const startNode = resolveId(loaded.nodes, input.id);
  if (!startNode) {
    return { ok: false, error: `Node not found: "${input.id}"` };
  }

  const resolved = resolveGraph(loaded);

  const visitedIds = new Set<string>();
  const resultEdges = new Set<Edge>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startNode.id, depth: 0 }];
  visitedIds.add(startNode.id);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= input.depth) continue;

    for (const edge of resolved.edges) {
      let follows = false;
      if (input.direction === "out" && edge.from === current.id) follows = true;
      if (input.direction === "in" && edge.to === current.id) follows = true;
      if (input.direction === "both" && (edge.from === current.id || edge.to === current.id)) {
        follows = true;
      }
      if (!follows) continue;
      if (input.relation_type && edge.relation !== input.relation_type) continue;

      resultEdges.add(edge);
      const neighborId = edge.from === current.id ? edge.to : edge.from;
      if (!visitedIds.has(neighborId)) {
        visitedIds.add(neighborId);
        queue.push({ id: neighborId, depth: current.depth + 1 });
      }
    }
  }

  const resultNodes = Array.from(visitedIds)
    .filter((id) => id !== startNode.id)
    .map((id) => loaded.nodes.get(id))
    .filter((n): n is AnyNode => n !== undefined);

  return { ok: true, data: { nodes: resultNodes, edges: Array.from(resultEdges) } };
}
