# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Part 6.6 — Graph-growth guardrails** (identity resolution + evolution):
  - New `supersedes` relation type (directed: "A replaces B"). Relation count grows from 10 → 11. Co-exists with the symmetric `conflicts_with`.
  - Deterministic similarity scorer in `@litopys/core` (`scoreSimilarity`, `findSimilar`) — combines alias overlap, type match, tag Jaccard, and Levenshtein-based id edit-distance. No embeddings, no LLM calls.
  - `litopys similar <id> [--explain] [--limit N] [--min-score F]` — prints ranked merge candidates with optional per-reason scoring breakdown.
  - `litopys propose-merge <id-a> <id-b>` — generates a full merge-preview (chosen winner id, merged aliases/tags/rels, surfaced conflicts) as a quarantine file alongside extractor candidates.
  - `litopys quarantine accept/reject` detects merge-proposal files and routes them to the merge pipeline: accept writes the merged node, tombstones the loser with `until: <today>`, and archives the proposal; reject archives the proposal with no graph mutation.
  - **Guardrail:** merges never apply automatically. Type conflicts block auto-apply entirely. External refs to the loser stay resolvable — the loser's file is preserved with `until` rather than deleted.
- Initial monorepo scaffolding (Part 1).
- MCP server-level `instructions` (Part 6.2): `DEFAULT_INSTRUCTIONS` constant in `packages/mcp/src/instructions.ts`, injected into MCP initialize response via `ServerOptions.instructions`. Overridable via `LITOPYS_MCP_INSTRUCTIONS` env var. Works with any MCP-compatible client (Claude Code, Claude Desktop, Cursor, Cline).
- MCP `startup-context` resource (Part 6.1): markdown snapshot of owner profile, active projects, recent events, and key lessons, served at `litopys://startup-context` and mirrored by `litopys startup-context` CLI for non-MCP consumers (session-start hooks, shell scripts).
- Generic `litopys ingest <file>` CLI (Part 6.3a): agent-agnostic entry point for transcript extraction with pluggable source adapters (Claude Code `.jsonl` out of the box).
- Periodic timer-daemon (Part 6.3b): systemd user-level service + timer in `packages/daemon/systemd/`, incremental tick from `byteOffset` state in `~/.litopys/daemon-state.json`, atomic tmp+rename writes, configurable sources.
- `litopys daemon baseline [--force] [--dry-run]` command: stamps current file sizes as starting offsets so the first tick doesn't replay months of history.
- Configurable Ollama request timeout via `LITOPYS_OLLAMA_TIMEOUT_MS` (default 15 min) — handles large transcript chunks without aborting mid-inference.

### Changed
- Default daemon glob now matches the real Claude Code layout (`~/.claude/projects/*/*.jsonl`) instead of the non-existent `sessions/` subdirectory.
