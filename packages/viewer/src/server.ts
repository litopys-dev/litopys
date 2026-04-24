import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  AnyNodeSchema,
  NodeType,
  RELATION_CONSTRAINTS,
  RelationName,
  defaultGraphPath,
  loadGraph,
  resolveGraph,
  writeNode,
} from "@litopys/core";
import type { AnyNode } from "@litopys/core";
import type { Edge, ResolvedGraph } from "@litopys/core";
import {
  acceptMergeProposal,
  isMergeProposalContent,
  listQuarantine,
  parseMergeProposal,
  promoteCandidate,
  rejectCandidate,
  rejectMergeProposal,
} from "@litopys/extractor";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CachedGraph {
  graph: ResolvedGraph;
  timestamp: number;
}

const CACHE_TTL_MS = 2000;
let _cache: CachedGraph | null = null;

async function getGraph(): Promise<ResolvedGraph> {
  const now = Date.now();
  if (_cache && now - _cache.timestamp < CACHE_TTL_MS) {
    return _cache.graph;
  }
  const gp = defaultGraphPath();
  const loaded = await loadGraph(gp);
  const graph = resolveGraph(loaded);
  _cache = { graph, timestamp: now };
  return graph;
}

function invalidateCache() {
  _cache = null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readRawNode(id: string): Promise<AnyNode | null> {
  const gp = defaultGraphPath();
  const loaded = await loadGraph(gp);
  return loaded.nodes.get(id) ?? null;
}

async function persistNode(node: AnyNode): Promise<void> {
  await writeNode(defaultGraphPath(), node);
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

async function apiStats(): Promise<Response> {
  const graph = await getGraph();
  const typeBreakdown: Record<string, number> = {};
  for (const node of graph.nodes.values()) {
    typeBreakdown[node.type] = (typeBreakdown[node.type] ?? 0) + 1;
  }
  return json({
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.length,
    typeBreakdown,
  });
}

async function apiNodes(): Promise<Response> {
  const graph = await getGraph();
  const result = [];
  for (const node of graph.nodes.values()) {
    result.push({
      id: node.id,
      type: node.type,
      summary: node.summary ?? "",
      tags: node.tags ?? [],
      updated: node.updated,
      confidence: node.confidence,
    });
  }
  // Sort by updated desc, then id asc
  result.sort((a, b) => {
    if (b.updated !== a.updated) return b.updated.localeCompare(a.updated);
    return a.id.localeCompare(b.id);
  });
  return json(result);
}

async function apiNode(id: string): Promise<Response> {
  const graph = await getGraph();
  const node = graph.nodes.get(id);
  if (!node) {
    return json({ error: "Not found" }, 404);
  }
  const incoming = graph.edges.filter((e) => e.to === id);
  const outgoing = graph.edges.filter((e) => e.from === id);
  return json({ node, incoming, outgoing });
}

async function apiGraph(): Promise<Response> {
  const graph = await getGraph();
  const nodes = [];
  for (const node of graph.nodes.values()) {
    nodes.push({
      data: {
        id: node.id,
        label: node.id,
        type: node.type,
        summary: node.summary ?? "",
      },
    });
  }
  const seen = new Set<string>();
  const edges = [];
  for (const e of graph.edges) {
    const key = e.symmetric
      ? `${[e.from, e.to].sort().join("|")}|${e.relation}`
      : `${e.from}|${e.to}|${e.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      data: {
        id: `${e.from}->${e.to}:${e.relation}`,
        source: e.from,
        target: e.to,
        relation: e.relation,
        symmetric: e.symmetric,
      },
    });
  }
  return json({ nodes, edges });
}

async function apiQuarantine(): Promise<Response> {
  const gp = defaultGraphPath();
  const files = await listQuarantine(gp);

  const result = await Promise.all(
    files.map(async (f) => {
      const basename = path.basename(f.filePath);
      let content: string;
      try {
        content = await fs.readFile(f.filePath, "utf-8");
      } catch {
        // File disappeared between list and read — skip
        return null;
      }

      if (isMergeProposalContent(content)) {
        try {
          const proposal = parseMergeProposal(content);
          return { kind: "merge" as const, filePath: basename, proposal };
        } catch {
          return null;
        }
      }

      return {
        kind: "regular" as const,
        filePath: basename,
        meta: f.meta,
        candidateCount: f.candidates.length,
        relationCount: f.relations.length,
        candidates: f.candidates.map((c) => ({
          id: c.id,
          type: c.type,
          summary: c.summary,
          confidence: c.confidence,
          reasoning: c.reasoning,
        })),
        relations: f.relations.map((r) => ({
          sourceId: r.sourceId,
          type: r.type,
          targetId: r.targetId,
        })),
      };
    }),
  );

  return json(result.filter(Boolean));
}

function resolveQuarantinePath(basename: string, graphPath: string): string {
  // Quarantine dir mirrors the extractor's quarantineDir helper:
  // path.join(graphPath, "..", "quarantine")
  const quarantineDir = path.join(graphPath, "..", "quarantine");
  // Strip any path components from client input — basename only.
  const safe = path.basename(basename);
  return path.join(quarantineDir, safe);
}

async function apiQuarantineAccept(req: Request): Promise<Response> {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return validationError("Invalid JSON body");

  const fileBasename = typeof body.filePath === "string" ? body.filePath : "";
  if (!fileBasename) return validationError("Missing 'filePath'");

  const gp = defaultGraphPath();
  const absPath = resolveQuarantinePath(fileBasename, gp);

  let content: string;
  try {
    content = await fs.readFile(absPath, "utf-8");
  } catch {
    return json({ error: "File not found" }, 404);
  }

  if (isMergeProposalContent(content)) {
    try {
      const result = await acceptMergeProposal(absPath, gp);
      invalidateCache();
      return json({ ok: true, result });
    } catch (e) {
      return json({ error: String((e as Error).message ?? e) }, 400);
    }
  }

  // Regular candidate — index required
  const indexRaw = body.index;
  if (indexRaw === undefined || indexRaw === null) {
    return validationError("Missing 'index' for regular quarantine file");
  }
  const index = Number(indexRaw);
  if (!Number.isFinite(index)) return validationError("'index' must be a number");

  try {
    await promoteCandidate(absPath, index, gp);
    invalidateCache();
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
}

async function apiQuarantineReject(req: Request): Promise<Response> {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return validationError("Invalid JSON body");

  const fileBasename = typeof body.filePath === "string" ? body.filePath : "";
  if (!fileBasename) return validationError("Missing 'filePath'");

  const gp = defaultGraphPath();
  const absPath = resolveQuarantinePath(fileBasename, gp);

  let content: string;
  try {
    content = await fs.readFile(absPath, "utf-8");
  } catch {
    return json({ error: "File not found" }, 404);
  }

  if (isMergeProposalContent(content)) {
    try {
      await rejectMergeProposal(absPath);
      invalidateCache();
      return json({ ok: true });
    } catch (e) {
      return json({ error: String((e as Error).message ?? e) }, 400);
    }
  }

  const indexRaw = body.index;
  if (indexRaw === undefined || indexRaw === null) {
    return validationError("Missing 'index' for regular quarantine file");
  }
  const index = Number(indexRaw);
  if (!Number.isFinite(index)) return validationError("'index' must be a number");

  const reason = typeof body.reason === "string" ? body.reason : undefined;

  try {
    await rejectCandidate(absPath, index, gp, reason);
    invalidateCache();
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
}

// ---------------------------------------------------------------------------
// Write handlers
// ---------------------------------------------------------------------------

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function validationError(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function apiCreateNode(req: Request): Promise<Response> {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return validationError("Invalid JSON body");

  const typeParsed = NodeType.safeParse(body.type);
  if (!typeParsed.success) return validationError("Invalid or missing 'type'");

  const idRaw = typeof body.id === "string" ? body.id : "";
  const candidate: AnyNode = {
    id: idRaw,
    type: typeParsed.data,
    summary: typeof body.summary === "string" ? body.summary : undefined,
    tags: Array.isArray(body.tags)
      ? (body.tags.filter((t) => typeof t === "string") as string[])
      : undefined,
    aliases: Array.isArray(body.aliases)
      ? (body.aliases.filter((t) => typeof t === "string") as string[])
      : undefined,
    body: typeof body.body === "string" ? body.body : undefined,
    confidence: typeof body.confidence === "number" ? body.confidence : 1,
    updated: today(),
    rels: undefined,
  } as AnyNode;

  const parsed = AnyNodeSchema.safeParse(candidate);
  if (!parsed.success) {
    return validationError(
      parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    );
  }

  const existing = await readRawNode(parsed.data.id);
  if (existing) return validationError(`Node '${parsed.data.id}' already exists`, 409);

  await persistNode(parsed.data);
  invalidateCache();
  return json({ node: parsed.data }, 201);
}

async function apiUpdateNode(id: string, req: Request): Promise<Response> {
  const existing = await readRawNode(id);
  if (!existing) return json({ error: "Not found" }, 404);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return validationError("Invalid JSON body");

  const merged: AnyNode = {
    ...existing,
    summary:
      body.summary === null
        ? undefined
        : typeof body.summary === "string"
          ? body.summary
          : existing.summary,
    body:
      body.body === null ? undefined : typeof body.body === "string" ? body.body : existing.body,
    tags: Array.isArray(body.tags)
      ? (body.tags.filter((t) => typeof t === "string") as string[])
      : existing.tags,
    aliases: Array.isArray(body.aliases)
      ? (body.aliases.filter((t) => typeof t === "string") as string[])
      : existing.aliases,
    confidence: typeof body.confidence === "number" ? body.confidence : existing.confidence,
    updated: today(),
  };

  const parsed = AnyNodeSchema.safeParse(merged);
  if (!parsed.success) {
    return validationError(
      parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    );
  }

  await persistNode(parsed.data);
  invalidateCache();
  return json({ node: parsed.data });
}

async function apiDeleteNode(id: string): Promise<Response> {
  const existing = await readRawNode(id);
  if (!existing) return json({ error: "Not found" }, 404);

  const tombstoned: AnyNode = {
    ...existing,
    until: today(),
    updated: today(),
  };

  const parsed = AnyNodeSchema.safeParse(tombstoned);
  if (!parsed.success) {
    return validationError(
      parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    );
  }

  await persistNode(parsed.data);
  invalidateCache();
  return new Response(null, { status: 204 });
}

async function apiAddRelation(id: string, req: Request): Promise<Response> {
  const source = await readRawNode(id);
  if (!source) return json({ error: "Source node not found" }, 404);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return validationError("Invalid JSON body");

  const relParsed = RelationName.safeParse(body.relation);
  if (!relParsed.success) return validationError("Invalid 'relation'");
  const targetId = typeof body.target === "string" ? body.target : "";
  if (!targetId) return validationError("Missing 'target'");

  const target = await readRawNode(targetId);
  if (!target) return json({ error: `Target node '${targetId}' not found` }, 404);

  const rel = relParsed.data;
  const constraint = RELATION_CONSTRAINTS[rel];
  if (!constraint.sources.includes(source.type)) {
    return validationError(
      `Relation '${rel}' cannot originate from type '${source.type}' (allowed: ${constraint.sources.join(", ")})`,
    );
  }
  if (!constraint.targets.includes(target.type)) {
    return validationError(
      `Relation '${rel}' cannot target type '${target.type}' (allowed: ${constraint.targets.join(", ")})`,
    );
  }

  const rels = { ...(source.rels ?? {}) } as Record<RelationName, string[]>;
  const current = rels[rel] ?? [];
  if (current.includes(targetId)) {
    return json({ node: source, noop: true });
  }
  rels[rel] = [...current, targetId];

  const updated: AnyNode = {
    ...source,
    rels,
    updated: today(),
  };

  const parsed = AnyNodeSchema.safeParse(updated);
  if (!parsed.success) {
    return validationError(
      parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    );
  }

  await persistNode(parsed.data);
  invalidateCache();
  return json({ node: parsed.data });
}

async function apiRemoveRelation(id: string, req: Request): Promise<Response> {
  const source = await readRawNode(id);
  if (!source) return json({ error: "Source node not found" }, 404);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return validationError("Invalid JSON body");

  const relParsed = RelationName.safeParse(body.relation);
  if (!relParsed.success) return validationError("Invalid 'relation'");
  const targetId = typeof body.target === "string" ? body.target : "";
  if (!targetId) return validationError("Missing 'target'");

  const rel = relParsed.data;
  const rels = { ...(source.rels ?? {}) } as Record<RelationName, string[]>;
  const current = rels[rel] ?? [];
  const next = current.filter((t) => t !== targetId);
  if (next.length === current.length) {
    return json({ node: source, noop: true });
  }
  if (next.length === 0) {
    delete rels[rel];
  } else {
    rels[rel] = next;
  }

  const updated: AnyNode = {
    ...source,
    rels: Object.keys(rels).length === 0 ? undefined : rels,
    updated: today(),
  };

  const parsed = AnyNodeSchema.safeParse(updated);
  if (!parsed.success) {
    return validationError(
      parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    );
  }

  await persistNode(parsed.data);
  invalidateCache();
  return json({ node: parsed.data });
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const DIST_DIR = path.join(import.meta.dir, "..", "dist");

async function serveStatic(urlPath: string): Promise<Response | null> {
  // Sanitize path
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const abs = path.join(DIST_DIR, rel);

  // Prevent path traversal
  if (!abs.startsWith(DIST_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(abs);
  if (!(await file.exists())) {
    return null;
  }

  const mime = getMime(rel);
  return new Response(file, {
    headers: { "Content-Type": mime },
  });
}

function getMime(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".ico")) return "image/x-icon";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}

async function serveFallback(): Promise<Response> {
  const file = Bun.file(path.join(DIST_DIR, "index.html"));
  if (!(await file.exists())) {
    return new Response("Dashboard not built. Run: bun run build", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response(file, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
  });
}

// ---------------------------------------------------------------------------
// Main server
// ---------------------------------------------------------------------------

export function createServer(port = 3999) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;

      // CORS (localhost only, no auth needed)
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204 });
      }

      // API routes
      if (p === "/api/stats") return apiStats();
      if (p === "/api/nodes") return apiNodes();
      if (p === "/api/graph") return apiGraph();
      if (p === "/api/quarantine" && req.method === "GET") return apiQuarantine();
      if (p === "/api/quarantine/accept" && req.method === "POST") return apiQuarantineAccept(req);
      if (p === "/api/quarantine/reject" && req.method === "POST") return apiQuarantineReject(req);

      if (p === "/api/node" && req.method === "POST") {
        return apiCreateNode(req);
      }

      const relMatch = p.match(/^\/api\/node\/([^/]+)\/relation$/);
      if (relMatch?.[1]) {
        const nodeId = decodeURIComponent(relMatch[1]);
        if (req.method === "POST") return apiAddRelation(nodeId, req);
        if (req.method === "DELETE") return apiRemoveRelation(nodeId, req);
        return json({ error: "Method not allowed" }, 405);
      }

      const nodeMatch = p.match(/^\/api\/node\/(.+)$/);
      if (nodeMatch?.[1]) {
        const nodeId = decodeURIComponent(nodeMatch[1]);
        if (req.method === "PUT") return apiUpdateNode(nodeId, req);
        if (req.method === "DELETE") return apiDeleteNode(nodeId);
        return apiNode(nodeId);
      }

      // Static assets
      const staticResp = await serveStatic(p);
      if (staticResp) return staticResp;

      // SPA fallback
      return serveFallback();
    },
    error(err) {
      console.error("[viewer]", err);
      return json({ error: "Internal server error" }, 500);
    },
  });
}

// Run directly
if (import.meta.main) {
  const port = Number(process.env.VIEWER_PORT ?? 3999);
  const server = createServer(port);
  console.log(`Viewer running at http://localhost:${server.port}/`);
}
