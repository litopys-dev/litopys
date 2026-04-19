#!/usr/bin/env bun
/**
 * Litopys MCP Server — HTTP/SSE transport.
 * Used by Claude Desktop and remote MCP clients.
 *
 * Endpoints:
 *   GET  /sse       — establish SSE stream
 *   POST /messages  — send JSON-RPC messages
 *
 * Environment:
 *   LITOPYS_MCP_TOKEN   Bearer token (required)
 *   LITOPYS_MCP_PORT    Port to listen on (default: 7777)
 *   LITOPYS_GRAPH_PATH  Path to graph directory (default: ./.litopys/graph)
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { checkBearer, resolveToken } from "./auth.ts";
import { createServer } from "./server.ts";

const token = resolveToken();
if (!token) {
  console.error("[litopys-mcp] LITOPYS_MCP_TOKEN is not set. Refusing to start in HTTP mode.");
  process.exit(1);
}

const port = Number(process.env.LITOPYS_MCP_PORT ?? "7777");

// Active SSE transports keyed by sessionId
const transports = new Map<string, SSEServerTransport>();

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const result = checkBearer(req.headers.authorization, token as string);
  if (!result.ok) {
    sendJson(res, 401, { error: result.error });
    return false;
  }
  return true;
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  // Health check (no auth)
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  // Auth required for all other routes
  if (!requireAuth(req, res)) return;

  // GET /sse — establish SSE stream
  if (req.method === "GET" && url.pathname === "/sse") {
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
      sendJson(res, 400, { error: "Missing sessionId parameter" });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      sendJson(res, 404, { error: `No active session: ${sessionId}` });
      return;
    }

    try {
      const body = await readBody(req);
      const parsed: unknown = body ? JSON.parse(body) : undefined;
      await transport.handlePostMessage(req, res, parsed);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: String(err) });
      }
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

httpServer.listen(port, () => {
  console.log(`[litopys-mcp] HTTP/SSE server listening on port ${port}`);
  console.log(`[litopys-mcp] SSE endpoint:  GET  http://localhost:${port}/sse`);
  console.log(`[litopys-mcp] Messages:      POST http://localhost:${port}/messages`);
});

process.on("SIGINT", async () => {
  for (const [id, t] of transports) {
    try {
      await t.close();
    } catch {
      // ignore
    }
    transports.delete(id);
  }
  httpServer.close(() => process.exit(0));
});
