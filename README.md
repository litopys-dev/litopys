<div align="center">

# 📜 Litopys

**A living chronicle for your AI.**

Persistent graph-based memory that survives across sessions and clients.
Built for Claude Code, Claude Desktop, and any MCP-compatible agent.

[![CI](https://github.com/litopys-dev/litopys/actions/workflows/ci.yml/badge.svg)](https://github.com/litopys-dev/litopys/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)

</div>

---

## Why Litopys?

Memory systems for AI agents today force a tradeoff: either heavy vector databases with subprocess leaks and ~500 MB RAM footprint, or flat markdown files that don't scale past a few dozen notes.

**Litopys takes a third path:** a typed graph of knowledge stored in plain markdown, served through a thin MCP layer (~50 MB RAM), editable by hand, queryable by both keyword and structure. Litopys means "chronicle" in Ukrainian — because that's exactly what your AI's memory should be: a living record of what it learned about you, when, and why.

## Features (planned v0.1)

- 🧠 **Typed graph** — 6 node types (person, project, system, concept, event, lesson) with first-class relations
- 🔌 **MCP-native** — works with Claude Code, Claude Desktop, Cursor, or any MCP client
- 📝 **Markdown-first** — all data is human-readable, hand-editable, git-versioned
- 🤖 **Model-agnostic extractor** — Anthropic, OpenAI, or local Ollama
- 🌐 **Web dashboard** — visualize, search, edit at `http://localhost:3999`
- 🔐 **Privacy-respecting** — your data never leaves your machine

## Status

🚧 **Pre-release, running live.** Parts 1–6.6 shipped (see [Roadmap](#roadmap)).
Author's own daily driver since 2026-04-20 — 38+ nodes, 81+ edges, daemon ticking every 5 min.
v0.1.0 public release lands with Part 7 (transport, installer, integrations).

## Quick Start

One-line install (Linux / macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | sh
```

This downloads a single ~100 MB binary to `~/.local/bin/litopys`, initializes `~/.litopys/graph/` with the required subdirectories, and prints MCP registration hints. Pin a specific version with `LITOPYS_VERSION=v0.1.0-alpha.1`.

Then register the MCP server with your client:

```bash
# Claude Code
claude mcp add litopys -- ~/.local/bin/litopys mcp stdio
```

```json
// Claude Desktop — ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "litopys": {
      "command": "/home/you/.local/bin/litopys",
      "args": ["mcp", "stdio"]
    }
  }
}
```

Restart the client. The `litopys://startup-context` resource auto-loads the owner profile, active projects, recent events, and key lessons on every new session. The agent reads/writes through five MCP tools: `litopys_search`, `litopys_get`, `litopys_related`, `litopys_create`, `litopys_link`.

Full client-specific recipes live in [`docs/integrations/`](./docs/integrations/) — Claude Code, Claude Desktop, Cursor, Cline, ChatGPT Connectors, Gemini.

### Remote (HTTP/SSE) mode

For remote clients (Claude Desktop connectors, browser-based MCP hosts):

```bash
LITOPYS_MCP_TOKEN=your-secret litopys mcp http
# listens on 127.0.0.1:7777 by default
# set LITOPYS_MCP_BIND_ADDR=0.0.0.0 + TLS proxy for remote exposure
# set LITOPYS_MCP_CORS_ORIGIN=https://your-client to enable CORS
```

### Dev install (from source)

```bash
git clone https://github.com/litopys-dev/litopys.git
cd litopys
bun install
bun run build:binary       # produces dist/litopys
```

### Optional — daemon for long-running transcripts

```bash
cp packages/daemon/systemd/litopys-daemon.{service,timer} ~/.config/systemd/user/
systemctl --user enable --now litopys-daemon.timer
```

## Roadmap

- [x] **Part 1** — Monorepo scaffolding
- [x] **Part 2** — Core graph model (loader, resolver, conflicts)
- [x] **Part 3** — MCP server (5 tools, SSE + stdio)
- [x] **Part 4** — Model-agnostic extractor + Quarantine + Weekly digest
- [x] **Part 5** — Migration from flat markdown memory + local Ollama extractor
- [x] **Part 6** — Universal auto-context / auto-write
  - [x] MCP `startup-context` resource — clients auto-load recent events + active projects on connect
  - [x] MCP server-level `instructions` — prompt-imprint for any agent ("search before answering, create on learning")
  - [x] Generic CLI `litopys ingest <file>` — agent-agnostic entry point for transcripts (not tied to any specific client)
  - [x] Periodic timer-daemon — incremental extraction from live transcripts without requiring session end
  - [x] Baseline command + configurable extractor timeout — avoids long first-tick backfill on existing history
- [ ] **Part 6.5** — Web dashboard (deferred) — Bun + SolidJS, `/graph`, `/table`, `/node/:id` CRUD, `/quarantine`, `/conflicts`
- [x] **Part 6.6** — Graph-growth guardrails (identity resolution + evolution)
  - [x] `supersedes` relation type (directed evolution: "A replaces B") alongside existing `conflicts_with`. Relation count grows from 10 → 11.
  - [x] `litopys similar <id> [--explain]` — deterministic merge candidates by alias / type / tag overlap / name edit-distance. No embeddings.
  - [x] `litopys propose-merge <a> <b>` — emits a full merge-preview (result id, aliases, merged relations, detected conflicts) into the existing `quarantine/` pipeline.
  - [x] Reuse `litopys quarantine accept/reject` for merge proposals — no separate review machinery. **Merge is never applied automatically; it requires explicit accept.** Accept writes the merged node + tombstones the loser with `until: <today>`; reject archives the proposal.
- [ ] **Part 7** — Remote transport + installer + integrations
  - MCP SSE/HTTP mode for remote clients (Claude Desktop, ChatGPT connectors, etc.)
  - Single-binary build (`bun build --compile`) + one-line installer
  - `docs/integrations/` — Claude Code, Claude Desktop, Cursor, Cline, ChatGPT, Gemini
  - Astro landing page, npm publish, v0.1.0 release

## Design principles

- **Agent-agnostic.** No hard dependency on any LLM vendor or client. MCP is the only integration point. Ollama is the default extractor; Anthropic/OpenAI are optional adapters.
- **Portable data.** The graph is plain markdown + YAML frontmatter on disk. Readable in any editor, versionable in git, greppable from the shell.
- **Light runtime.** ~50 MB RAM for the MCP server. The extractor is out-of-process and runs on your schedule, not on every request.
- **Opt-in integrations.** Client-specific helpers (hooks, config snippets) live in `docs/integrations/` — you can use Litopys without any of them.

## License

MIT © 2026 Denis Blashchytsia and Litopys contributors.
