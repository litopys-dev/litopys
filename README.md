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
- [x] **Part 4** — Model-agnostic extractor + SessionEnd hook + Quarantine + Weekly digest
- [ ] **Part 5** — Migration from flat markdown memory
- [ ] **Part 6** — Web dashboard with full CRUD
- [ ] **Part 7** — Claude Desktop integration + v0.1.0 release

## License

MIT © 2026 Denis Blashchytsia ([REDACTED](REDACTED)) and Litopys contributors.
