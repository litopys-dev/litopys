# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial monorepo scaffolding (Part 1).
- MCP server-level `instructions` (Part 6.2): `DEFAULT_INSTRUCTIONS` constant in `packages/mcp/src/instructions.ts`, injected into MCP initialize response via `ServerOptions.instructions`. Overridable via `LITOPYS_MCP_INSTRUCTIONS` env var. Works with any MCP-compatible client (Claude Code, Claude Desktop, Cursor, Cline).
- MCP `startup-context` resource (Part 6.1): markdown snapshot of owner profile, active projects, recent events, and key lessons, served at `litopys://startup-context` and mirrored by `litopys startup-context` CLI for non-MCP consumers (session-start hooks, shell scripts).
- Generic `litopys ingest <file>` CLI (Part 6.3a): agent-agnostic entry point for transcript extraction with pluggable source adapters (Claude Code `.jsonl` out of the box).
- Periodic timer-daemon (Part 6.3b): systemd user-level service + timer in `packages/daemon/systemd/`, incremental tick from `byteOffset` state in `~/.litopys/daemon-state.json`, atomic tmp+rename writes, configurable sources.
- `litopys daemon baseline [--force] [--dry-run]` command: stamps current file sizes as starting offsets so the first tick doesn't replay months of history.
- Configurable Ollama request timeout via `LITOPYS_OLLAMA_TIMEOUT_MS` (default 15 min) — handles large transcript chunks without aborting mid-inference.

### Changed
- Default daemon glob now matches the real Claude Code layout (`~/.claude/projects/*/*.jsonl`) instead of the non-existent `sessions/` subdirectory.
