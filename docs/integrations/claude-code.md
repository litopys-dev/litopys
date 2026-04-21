# Claude Code

[Claude Code](https://docs.claude.com/en/docs/claude-code) is Anthropic's official CLI. It speaks MCP over stdio.

## Register

```bash
claude mcp add litopys -- ~/.local/bin/litopys mcp stdio
```

Restart Claude Code (or run `/mcp` and reconnect). The five Litopys tools — `litopys_search`, `litopys_get`, `litopys_related`, `litopys_create`, `litopys_link` — become available automatically, and the `litopys://startup-context` resource auto-loads on every new session (owner profile, active projects, recent events, key lessons).

## Verify

```bash
claude mcp list
# should show: litopys (connected)
```

Inside Claude Code, ask something like "what does Litopys know about me?" — the agent should call `litopys_search` and return hits.

## Scoped graphs (optional)

Point Claude Code at a per-project graph instead of the global one by passing env:

```bash
claude mcp add litopys-work -- env LITOPYS_GRAPH_PATH=/path/to/work/graph \
  ~/.local/bin/litopys mcp stdio
```

## Session-start hook (optional)

The `litopys://startup-context` resource is auto-served, but some workflows prefer injecting it as a regular prompt. Add a `SessionStart` hook in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": "~/.local/bin/litopys startup-context"
  }
}
```

The hook prints a markdown snapshot that Claude Code prepends to the conversation.

## Troubleshooting

- **"Could not spawn litopys"** — the binary is not on PATH for the Claude Code process. Use the absolute path (`/home/you/.local/bin/litopys`) in the `mcp add` command.
- **"Tool not found: litopys_create with relation type supersedes"** — your MCP server is from a pre-6.6 build. `claude mcp remove litopys` → reinstall → `/mcp` reconnect.
