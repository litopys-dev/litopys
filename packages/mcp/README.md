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
      "args": ["/home/denis/litopys/packages/mcp/src/stdio.ts"],
      "env": {
        "LITOPYS_GRAPH_PATH": "/home/denis/.litopys/graph"
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

A service unit is provided at `systemd/litopys-mcp.service`. The token goes in `/home/denis/.litopys/mcp.env`:

```
LITOPYS_MCP_TOKEN=your-secret-here
```

## Security

- `LITOPYS_MCP_TOKEN` is required for the HTTP transport. The server refuses to start without it.
- All HTTP requests must include `Authorization: Bearer <token>`.
- stdio transport has no auth — it runs locally, access is controlled by OS permissions.
- Never commit `.litopys/mcp.env` or your token.
