# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial monorepo scaffolding (Part 1)
- MCP server-level `instructions` (Part 6.2): `DEFAULT_INSTRUCTIONS` constant in `packages/mcp/src/instructions.ts`, injected into MCP initialize response via `ServerOptions.instructions`. Overridable via `LITOPYS_MCP_INSTRUCTIONS` env var. Works with any MCP-compatible client (Claude Code, Claude Desktop, Cursor, Cline).
