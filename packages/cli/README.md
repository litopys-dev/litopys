# @litopys/cli

Command-line interface for Litopys graph memory.

## Commands

### `litopys ingest <spec> [options]`

Ingest a transcript file (or glob of files) into the quarantine queue for review.

**`<spec>`** has the form `<adapter>:<path-or-glob>`:

| Adapter | Example |
|---|---|
| `text` | `text:/tmp/my-notes.txt` |
| `jsonl` | `jsonl:~/exports/chat-2026-04.jsonl` |
| `claude-code` | `claude-code:~/.claude/projects/PROJ/abc-123.jsonl` |

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--provider <name>` | env `LITOPYS_EXTRACTOR_PROVIDER` or `anthropic` | LLM provider: `anthropic`, `openai`, `ollama` |
| `--dry-run` | off | Print what would be written without touching quarantine |
| `--max-chunk-bytes <N>` | `100000` | Split large files before sending to LLM (~25k tokens per chunk) |

**Examples:**

```bash
# Ingest a plain text conversation (dry-run first)
litopys ingest text:/tmp/alice-chat.txt --dry-run
litopys ingest text:/tmp/alice-chat.txt

# Ingest all Claude Code sessions for a project
litopys ingest claude-code:~/.claude/projects/acme-api/*.jsonl

# Ingest a ChatGPT JSON export converted to JSONL, using local Ollama
litopys ingest jsonl:~/exports/chatgpt.jsonl --provider ollama
```

### `litopys quarantine list`

List all pending quarantine items awaiting review.

### `litopys quarantine accept <file> <index>`

Promote candidate at `index` from quarantine file to the graph.

### `litopys quarantine reject <file> <index> [reason]`

Reject a candidate — removes it from the file and appends to `rejected.jsonl` audit log.

### `litopys digest`

Generate a weekly digest from the current graph state.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LITOPYS_GRAPH_PATH` | `.litopys/graph` | Path to the graph directory |
| `LITOPYS_EXTRACTOR_PROVIDER` | `anthropic` | LLM provider for extraction |
| `ANTHROPIC_API_KEY` | — | Required for `anthropic` provider |
| `OPENAI_API_KEY` | — | Required for `openai` provider |
