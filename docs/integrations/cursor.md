# Cursor

[Cursor](https://cursor.com) supports MCP via its settings JSON. Configuration mirrors Claude Desktop.

## Register

Open Cursor settings (`⌘,` / `Ctrl+,`), search for "MCP", and add:

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

Or edit `~/.cursor/mcp.json` directly.

Restart Cursor. The five Litopys tools become available in any MCP-aware conversation (Agent mode, Composer).

## Verify

In the Agent mode chat, ask: *"What Litopys nodes do I have of type `project`?"* — Cursor's agent should call `litopys_search` with `types: ["project"]`.

## Per-workspace graphs

Pin a graph to a specific repo by dropping `.cursor/mcp.json` in the workspace:

```json
{
  "mcpServers": {
    "litopys-this-repo": {
      "command": "/Users/you/.local/bin/litopys",
      "args": ["mcp", "stdio"],
      "env": {
        "LITOPYS_GRAPH_PATH": "${workspaceFolder}/.litopys/graph"
      }
    }
  }
}
```

## Troubleshooting

- **MCP tab shows "Error" next to litopys** — click the row to see the stderr output. Most common cause: wrong absolute path to the binary.
- **Tools don't appear in chat** — Cursor only surfaces MCP tools in Agent mode, not regular chat.
