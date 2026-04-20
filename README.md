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

🚧 **Early development.** See [CHANGELOG.md](CHANGELOG.md) and [ROADMAP](#roadmap).

## Quick Start

*Installation guide coming in v0.1.0.*

## Roadmap

- [x] **Part 1** — Monorepo scaffolding
- [x] **Part 2** — Core graph model (loader, resolver, conflicts)
- [x] **Part 3** — MCP server (5 tools, SSE + stdio)
- [x] **Part 4** — Model-agnostic extractor + Quarantine + Weekly digest
- [x] **Part 5** — Migration from flat markdown memory + local Ollama extractor
- [ ] **Part 6** — Universal auto-context / auto-write
  - MCP `startup-context` resource — clients auto-load recent events + active projects on connect
  - [x] MCP server-level `instructions` — prompt-imprint for any agent ("search before answering, create on learning")
  - Generic CLI `litopys ingest <file>` — agent-agnostic entry point for transcripts (not tied to any specific client)
  - Periodic timer-daemon — incremental extraction from live transcripts without requiring session end
  - Web dashboard (Bun + SolidJS) — `/graph`, `/table`, `/node/:id` CRUD, `/quarantine`, `/conflicts`
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
