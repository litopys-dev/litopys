/**
 * `litopys mcp <stdio|http>` — run the MCP server.
 *
 * This dispatcher lets the single compiled binary serve as both the CLI
 * management surface and the MCP server that clients (Claude Code,
 * Claude Desktop, Cursor, …) register with.
 */

import { createHttpServer, resolveToken, startStdioServer } from "@litopys/mcp";

const DEFAULT_PORT = 7777;
const DEFAULT_BIND_ADDR = "127.0.0.1";

function mcpUsage(): void {
  process.stderr.write(`litopys mcp <subcommand>

Subcommands:
  stdio                     Run the MCP server over stdio (for Claude Code, etc.)
  http [--port N]           Run the MCP server over HTTP/SSE (for Claude Desktop, remote clients)
                            Requires LITOPYS_MCP_TOKEN.
                            Honors LITOPYS_MCP_PORT (default: ${DEFAULT_PORT})
                            Honors LITOPYS_MCP_BIND_ADDR (default: ${DEFAULT_BIND_ADDR})
                            Honors LITOPYS_MCP_CORS_ORIGIN (default: disabled)
`);
}

async function runStdio(): Promise<void> {
  await startStdioServer();
}

async function runHttp(args: string[]): Promise<void> {
  const token = resolveToken();
  if (!token) {
    process.stderr.write(
      "[litopys-mcp] LITOPYS_MCP_TOKEN is not set. Refusing to start in HTTP mode.\n",
    );
    process.exit(1);
  }

  let port = Number(process.env.LITOPYS_MCP_PORT ?? String(DEFAULT_PORT));
  const bindAddr = process.env.LITOPYS_MCP_BIND_ADDR ?? DEFAULT_BIND_ADDR;
  const corsOrigin = process.env.LITOPYS_MCP_CORS_ORIGIN;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port") {
      const val = args[++i];
      if (val === undefined) throw new Error("--port requires a number");
      const n = Number.parseInt(val, 10);
      if (Number.isNaN(n) || n <= 0 || n > 65535) throw new Error(`Invalid --port: ${val}`);
      port = n;
    } else {
      throw new Error(`Unknown mcp http flag: ${a}`);
    }
  }

  const handle = createHttpServer({ token, port, bindAddr, corsOrigin });
  handle.server.listen(port, bindAddr, () => {
    process.stdout.write(`[litopys-mcp] HTTP/SSE listening on http://${bindAddr}:${port}\n`);
    if (bindAddr !== DEFAULT_BIND_ADDR) {
      process.stdout.write(
        `[litopys-mcp] Warning: bound to ${bindAddr}. Put it behind TLS for remote use.\n`,
      );
    }
  });

  const shutdown = async (): Promise<void> => {
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function cmdMcp(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub) {
    mcpUsage();
    process.exit(1);
  }

  if (sub === "stdio") {
    await runStdio();
  } else if (sub === "http") {
    await runHttp(args.slice(1));
  } else {
    process.stderr.write(`Unknown mcp subcommand: ${sub}\n`);
    mcpUsage();
    process.exit(1);
  }
}
