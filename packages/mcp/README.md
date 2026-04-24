# @litopys/mcp

MCP server for the Litopys knowledge graph. Exposes 5 tools over stdio (Claude Code) and HTTP/SSE (Claude Desktop).

## Tools

| Tool | Description |
|---|---|
| `litopys_search` | Full-text search by name, alias, body, tags |
| `litopys_get` | Get a node by id or alias, with optional edges |
| `litopys_create` | Create a new node |
| `litopys_link` | Add a relation between two nodes |
| `litopys_related` | BFS traversal — get connected subgraph |

## Running (stdio — Claude Code)

```bash
LITOPYS_GRAPH_PATH=/path/to/graph bun packages/mcp/src/stdio.ts
```

Add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "litopys": {
      "command": "bun",
      "args": ["/path/to/litopys/packages/mcp/src/stdio.ts"],
      "env": {
        "LITOPYS_GRAPH_PATH": "~/.litopys/graph"
      }
    }
  }
}
```

## Running (HTTP/SSE — Claude Desktop)

```bash
LITOPYS_MCP_TOKEN=your-secret-token \
LITOPYS_MCP_PORT=7777 \
LITOPYS_GRAPH_PATH=/path/to/graph \
bun packages/mcp/src/http.ts
```

Claude Desktop config (replace `<HOST>` and `<BEARER_TOKEN>`):

```json
{
  "mcpServers": {
    "litopys": {
      "transport": "sse",
      "url": "http://<HOST>:7777/sse",
      "headers": {
        "Authorization": "Bearer <BEARER_TOKEN>"
      }
    }
  }
}
```

## Systemd

A service unit is provided at `systemd/litopys-mcp.service`. The token goes in `~/.litopys/mcp.env`:

```
LITOPYS_MCP_TOKEN=your-secret-here
```

## Server instructions

On every MCP initialize handshake, the server sends an `instructions` field to the client.
Any MCP-compatible host (Claude Code, Claude Desktop, Cursor, Cline, …) automatically injects
this text into the agent's system prompt.

The default text tells the agent to:
- Call `litopys_search` before answering questions about the user, their projects, or preferences.
- Call `litopys_create` when a new stable fact emerges (preference, decision, lesson).
- Call `litopys_link` immediately after creating, when a relation to an existing node exists.
- Avoid duplicates by searching before creating; use kebab-case ids; only store facts with confidence ≥ 0.7.

### Override

Set the environment variable `LITOPYS_MCP_INSTRUCTIONS` to replace the default text entirely:

```bash
LITOPYS_MCP_INSTRUCTIONS="Your custom prompt text here" bun packages/mcp/src/stdio.ts
```

For the HTTP transport add it to your `.env` or systemd unit alongside `LITOPYS_MCP_TOKEN`.

## Resources

| Resource URI | Description |
|---|---|
| `litopys://startup-context` | Compressed graph snapshot: owner profile, active projects, recent events, key lessons |

The `startup-context` resource is automatically exposed on every MCP connection.
MCP-compatible clients (Claude Desktop, Cursor, Cline, …) can subscribe to resources and
inject the content into the agent's context at startup — giving the agent an immediate
understanding of who the user is and what is currently active.

The content is plain markdown, capped at ~6 KB, and includes:
- **Owner** — the person node tagged `owner`
- **Active Projects** — top project nodes sorted by `updated` desc
- **Recent Events** — top event nodes sorted by `updated` desc
- **Key Lessons** — top lesson nodes sorted by `updated` desc
- **Graph Statistics** — total node/edge counts by type

### ENV options

| Variable | Default | Effect |
|---|---|---|
| `LITOPYS_STARTUP_CONTEXT_DISABLED=1` | — | Do not register the resource at all |
| `LITOPYS_STARTUP_CONTEXT_LIMIT=N` | `10` | Override top-N for every section |

```bash
# Disable startup context entirely
LITOPYS_STARTUP_CONTEXT_DISABLED=1 bun packages/mcp/src/stdio.ts

# Show only top 5 entries per section
LITOPYS_STARTUP_CONTEXT_LIMIT=5 bun packages/mcp/src/stdio.ts
```

## Security

- `LITOPYS_MCP_TOKEN` is required for the HTTP transport. The server refuses to start without it.
- All HTTP requests must include `Authorization: Bearer <token>`.
- stdio transport has no auth — it runs locally, access is controlled by OS permissions.
- Never commit `.litopys/mcp.env` or your token.
