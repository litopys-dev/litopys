import * as path from "node:path";
import { defaultGraphPath, loadGraph, resolveGraph } from "@litopys/core";
import type { AnyNode, NodeType } from "@litopys/core";
import type { Edge, ResolvedGraph } from "@litopys/core";
import { listQuarantine } from "@litopys/extractor";

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

async function apiQuarantine(): Promise<Response> {
  const gp = defaultGraphPath();
  const files = await listQuarantine(gp);
  const result = files.map((f) => ({
    filePath: path.basename(f.filePath),
    meta: f.meta,
    candidateCount: f.candidates.length,
    relationCount: f.relations.length,
    candidates: f.candidates.map((c) => ({
      id: c.id,
      type: c.type,
      summary: c.summary,
      confidence: c.confidence,
    })),
  }));
  return json(result);
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
      if (p === "/api/quarantine") return apiQuarantine();

      const nodeMatch = p.match(/^\/api\/node\/(.+)$/);
      if (nodeMatch?.[1]) {
        return apiNode(decodeURIComponent(nodeMatch[1]));
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
