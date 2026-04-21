# Integrations

Client-specific recipes for wiring Litopys into MCP-compatible hosts.

| Client | Support | Notes |
|---|---|---|
| [Claude Code](./claude-code.md) | ✅ Full | Stdio transport, session-start hook friendly |
| [Claude Desktop](./claude-desktop.md) | ✅ Full | Stdio or remote HTTP/SSE |
| [Cursor](./cursor.md) | ✅ Full | Settings JSON |
| [Cline](./cline.md) | ✅ Full | VS Code settings |
| [ChatGPT](./chatgpt.md) | ⚠️ Limited | Workspace connectors only |
| [Gemini](./gemini.md) | ⚠️ Limited | MCP support is still evolving |

All recipes assume you've already installed Litopys:

```bash
curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | sh
```

The binary lives at `~/.local/bin/litopys` by default. The graph lives at `~/.litopys/graph` by default. Both are overridable via `LITOPYS_INSTALL_DIR` / `LITOPYS_GRAPH_PATH`.

## Prefer stdio

For local installs, always prefer stdio transport (`litopys mcp stdio`):

- No token management.
- No port conflicts.
- Client restarts the process on its own.

Reach for HTTP/SSE (`litopys mcp http`) only when:

- The client runs on a different machine than the graph.
- The client only supports HTTP transport (e.g. some remote connectors).
- You want to share one graph across multiple clients on the same host (rare — stdio per client is simpler).
