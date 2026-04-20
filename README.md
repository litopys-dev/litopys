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

🚧 **Pre-release, running live.** Parts 1–6 shipped (see [Roadmap](#roadmap)).
Author's own daily driver since 2026-04-20 — 37 nodes, 79 edges, daemon ticking every 5 min.
v0.1.0 public release lands with Part 7 (transport, installer, integrations).

## Quick Start

Prerequisites: [Bun](https://bun.sh) ≥ 1.1, an MCP-compatible client (Claude Code, Claude Desktop, Cursor, Cline, …), and — for local extraction — [Ollama](https://ollama.com) with `qwen2.5:7b` pulled.

```bash
git clone https://github.com/litopys-dev/litopys.git
cd litopys
bun install

# Point Litopys at a graph directory (defaults to ~/.litopys/graph)
export LITOPYS_GRAPH_PATH="$HOME/.litopys/graph"
mkdir -p "$LITOPYS_GRAPH_PATH"/{people,projects,systems,concepts,events,lessons}

# Register the MCP server with your client (stdio mode).
# Example — Claude Code:
claude mcp add litopys -- bun run /absolute/path/to/litopys/packages/mcp/src/index.ts
```

Then restart the client. The `litopys://startup-context` resource auto-loads the owner profile, active projects, recent events, and key lessons on every new session. The agent can read/write through five MCP tools: `litopys_search`, `litopys_get`, `litopys_related`, `litopys_create`, `litopys_link`.

Optional — schedule the daemon for incremental extraction from long-running transcripts:

```bash
cp packages/daemon/systemd/litopys-daemon.{service,timer} ~/.config/systemd/user/
systemctl --user enable --now litopys-daemon.timer
```

A full installer and single-binary build ship with Part 7.

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
- [ ] **Part 6.6** — Graph-growth guardrails (identity resolution + evolution)
  - Add `supersedes` relation type (directed evolution: "A replaces B") alongside existing `conflicts_with`.
  - `litopys similar <id> [--explain]` — deterministic merge candidates by alias / type / tag overlap / name edit-distance. No embeddings.
  - `litopys propose-merge <a> <b>` — emits a full merge-preview (result id, aliases, merged relations, detected conflicts) into the existing `quarantine/` pipeline.
  - Reuse `litopys quarantine accept/reject` for merge proposals — no separate review machinery. **Merge is never applied automatically; it requires explicit accept.**
  - Tests: guardrail that no merge touches the graph without an accept; conflict detection catches incompatible `summary` / relation-set differences.
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
