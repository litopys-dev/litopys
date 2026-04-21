# Claude Desktop

[Claude Desktop](https://claude.ai/download) speaks MCP over stdio via a config file.

## Register (stdio)

Edit `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the `litopys` entry inside `mcpServers`:

```json
{
  "mcpServers": {
    "litopys": {
      "command": "/Users/you/.local/bin/litopys",
      "args": ["mcp", "stdio"],
      "env": {
        "LITOPYS_GRAPH_PATH": "/Users/you/.litopys/graph"
      }
    }
  }
}
```

Use the absolute path to the binary — Claude Desktop does not inherit your shell's PATH. Quit Claude Desktop from the menu (not just close the window) and relaunch.

## Verify

Open a new conversation. A plug icon next to the text input should show `litopys` connected. Ask: *"search my Litopys graph for 'python'"* — Claude should call `litopys_search`.

## Remote mode (HTTP/SSE)

Use HTTP when the graph lives on a different machine (e.g., a home server):

```json
{
  "mcpServers": {
    "litopys-remote": {
      "transport": "sse",
      "url": "https://litopys.yourdomain.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR-TOKEN"
      }
    }
  }
}
```

On the server:

```bash
LITOPYS_MCP_TOKEN=YOUR-TOKEN LITOPYS_MCP_BIND_ADDR=127.0.0.1 \
  ~/.local/bin/litopys mcp http
# then reverse-proxy through nginx + TLS
```

See the [ChatGPT integration doc](./chatgpt.md#server-setup) for a full nginx snippet — the server-side setup is identical.

## Troubleshooting

- **Config changes not applied** — Claude Desktop caches config. Force-quit from the menu, then relaunch.
- **"Failed to spawn"** — verify the binary path with `which litopys` in your shell, and paste the absolute output into the config.
