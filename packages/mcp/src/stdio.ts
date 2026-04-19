#!/usr/bin/env bun
/**
 * Litopys MCP Server — stdio transport.
 * Used by Claude Code and other local MCP clients.
 *
 * Usage:
 *   bun packages/mcp/src/stdio.ts
 *
 * Environment:
 *   LITOPYS_GRAPH_PATH  path to the graph directory (default: ./.litopys/graph)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

const server = createServer();
const transport = new StdioServerTransport();

await server.connect(transport);
