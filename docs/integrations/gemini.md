# Gemini

Native MCP support in Google's Gemini apps (Gemini web, Gemini app, AI Studio) is **evolving** — at the time of writing (April 2026), the story is less settled than for Claude/Cursor/Cline. Three paths:

## 1. Gemini CLI (`gemini-cli`)

The official `gemini-cli` project supports MCP servers via a config file similar to Claude Desktop:

```json
{
  "mcpServers": {
    "litopys": {
      "command": "/home/you/.local/bin/litopys",
      "args": ["mcp", "stdio"]
    }
  }
}
```

Location varies by version — check `gemini-cli --help` for the current config path. Restart the CLI after editing.

## 2. AI Studio / Vertex AI function calling

If you're building a Gemini-powered agent with the Vertex AI SDK, you can bridge Litopys manually: have your agent code call Litopys via the MCP TypeScript SDK, then pass the results into Gemini's function-calling API. There's no turnkey "add MCP server" UI.

A minimal bridge is on the roadmap (not yet shipped).

## 3. Consumer Gemini (web / Android / iOS)

Consumer Gemini does not speak MCP. You'd have to export Litopys nodes as plain text (e.g. `litopys startup-context`) and paste them in, which defeats the purpose.

## Recommendation

If you're on Claude Code / Desktop / Cursor / Cline, stay there — they're the most stable MCP hosts today. Revisit Gemini once its MCP story stabilizes; this page will be updated then.
