#!/usr/bin/env bun
/**
 * Litopys MCP Server — HTTP/SSE transport.
 * Used by Claude Desktop and remote MCP clients.
 *
 * Endpoints:
 *   GET  /health    — liveness probe (no auth)
 *   GET  /sse       — establish SSE stream (bearer auth)
 *   POST /messages  — send JSON-RPC messages (bearer auth)
 *
 * Environment:
 *   LITOPYS_MCP_TOKEN         Bearer token (required)
 *   LITOPYS_MCP_PORT          Port to listen on (default: 7777)
 *   LITOPYS_MCP_BIND_ADDR     Interface to bind (default: 127.0.0.1 — localhost only)
 *   LITOPYS_MCP_CORS_ORIGIN   Allow-list origin for browser clients (default: disabled)
 *   LITOPYS_GRAPH_PATH        Path to graph directory (default: ~/.litopys/graph)
 *
 * Security note: default bind is localhost. To expose to a remote network,
 * explicitly set LITOPYS_MCP_BIND_ADDR=0.0.0.0 (and put it behind nginx/TLS).
 */
import http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { checkBearer, resolveToken } from "./auth.ts";
import { createServer } from "./server.ts";

export interface HttpServerOptions {
  token: string;
  bindAddr?: string;
  port?: number;
  corsOrigin?: string;
}

export interface HttpServerHandle {
  server: Server;
  close: () => Promise<void>;
}

const DEFAULT_PORT = 7777;
const DEFAULT_BIND_ADDR = "127.0.0.1";

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    ...extraHeaders,
  });
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Build an HTTP server that serves the MCP SSE transport.
 * Exported so tests can boot it against an ephemeral port.
 */
export function createHttpServer(opts: HttpServerOptions): HttpServerHandle {
  const { token, corsOrigin } = opts;
  const transports = new Map<string, SSEServerTransport>();

  const corsHeaders: Record<string, string> = corsOrigin
    ? {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
      }
    : {};

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // CORS preflight (no auth required)
    if (corsOrigin && req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // Health check (no auth)
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: "ok" }, corsHeaders);
      return;
    }

    // Auth gate
    const authResult = checkBearer(req.headers.authorization, token);
    if (!authResult.ok) {
      sendJson(res, 401, { error: authResult.error }, corsHeaders);
      return;
    }

    // GET /sse — establish SSE stream
    if (req.method === "GET" && url.pathname === "/sse") {
      for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
      const mcpServer = createServer();
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);
      transport.onclose = () => {
        transports.delete(sessionId);
      };
      await mcpServer.connect(transport);
      return;
    }

    // POST /messages — receive JSON-RPC
    if (req.method === "POST" && url.pathname === "/messages") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        sendJson(res, 400, { error: "Missing sessionId parameter" }, corsHeaders);
        return;
      }
      const transport = transports.get(sessionId);
      if (!transport) {
        sendJson(res, 404, { error: `No active session: ${sessionId}` }, corsHeaders);
        return;
      }
      try {
        const body = await readBody(req);
        const parsed: unknown = body ? JSON.parse(body) : undefined;
        await transport.handlePostMessage(req, res, parsed);
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 500, { error: String(err) }, corsHeaders);
        }
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" }, corsHeaders);
  });

  return {
    server,
    close: async () => {
      for (const [id, t] of transports) {
        try {
          await t.close();
        } catch {
          // ignore
        }
        transports.delete(id);
      }
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------------
// Bootstrap — only runs when invoked directly (not when imported by tests)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const token = resolveToken();
  if (!token) {
    console.error("[litopys-mcp] LITOPYS_MCP_TOKEN is not set. Refusing to start in HTTP mode.");
    process.exit(1);
  }

  const port = Number(process.env.LITOPYS_MCP_PORT ?? String(DEFAULT_PORT));
  const bindAddr = process.env.LITOPYS_MCP_BIND_ADDR ?? DEFAULT_BIND_ADDR;
  const corsOrigin = process.env.LITOPYS_MCP_CORS_ORIGIN;

  const handle = createHttpServer({ token, port, bindAddr, corsOrigin });
  handle.server.listen(port, bindAddr, () => {
    console.log(`[litopys-mcp] HTTP/SSE server listening on http://${bindAddr}:${port}`);
    console.log("[litopys-mcp] SSE endpoint:  GET  /sse");
    console.log("[litopys-mcp] Messages:      POST /messages?sessionId=<id>");
    console.log("[litopys-mcp] Health:        GET  /health");
    if (corsOrigin) console.log(`[litopys-mcp] CORS origin: ${corsOrigin}`);
    if (bindAddr !== DEFAULT_BIND_ADDR) {
      console.log(`[litopys-mcp] Warning: bound to ${bindAddr}. Put it behind TLS for remote use.`);
    }
  });

  process.on("SIGINT", async () => {
    await handle.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await handle.close();
    process.exit(0);
  });
}
