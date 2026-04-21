# Cline

[Cline](https://cline.bot) (formerly Claude Dev) is a VS Code extension. It ships with an MCP marketplace and a hand-rolled config.

## Register

Open VS Code command palette → *"Cline: MCP Servers"*. Click *"Configure MCP Servers"* — this opens `cline_mcp_settings.json`. Add:

```json
{
  "mcpServers": {
    "litopys": {
      "command": "/home/you/.local/bin/litopys",
      "args": ["mcp", "stdio"],
      "env": {
        "LITOPYS_GRAPH_PATH": "/home/you/.litopys/graph"
      },
      "disabled": false,
      "autoApprove": ["litopys_search", "litopys_get", "litopys_related"]
    }
  }
}
```

`autoApprove` is optional — it lets Cline call read-only tools without asking each time. Keep writes (`litopys_create`, `litopys_link`) behind manual approval if you prefer.

Reload the window or toggle the server in Cline's MCP panel.

## Verify

Start a Cline task. Ask: *"Search my Litopys graph for anything about TypeScript."* — Cline should invoke `litopys_search` and show the JSON response.

## Troubleshooting

- **Server stays in "connecting…"** — check the Cline output channel (`Ctrl+`` → Output → Cline) for spawn errors.
- **Writes are denied** — Cline prompts per-tool-call. Remove the tool from `autoApprove` to allow interactive approval, or add it to always-allow.
