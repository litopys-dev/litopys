# @litopys/daemon

Periodic timer-daemon for incremental knowledge extraction from live transcripts.

## What it does

Instead of waiting for a session to end, the daemon wakes up every N minutes,
reads only the **new bytes** appended to known transcript files since the last tick,
runs them through the extractor, and writes results to quarantine.

- One daemon on one machine covers all AI clients (Claude Code, future: Claude Desktop, Cursor).
- Per-file byte offsets are persisted in `~/.litopys/daemon-state.json` so nothing is read twice.
- File rotation / truncation is detected via mtime + size checks and triggers a full re-read.
- A single file error never stops the rest of the tick.

## Quick start

### One-shot tick

```bash
litopys daemon tick
```

### Status

```bash
litopys daemon status
```

### Reset offsets

```bash
litopys daemon reset             # reset all tracked files
litopys daemon reset /path/file  # reset one file
```

## Systemd (user-level timer)

Copy the unit files and enable:

```bash
mkdir -p ~/.config/systemd/user
cp packages/daemon/systemd/litopys-daemon.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now litopys-daemon.timer
```

Check status:

```bash
systemctl --user status litopys-daemon.timer
journalctl --user -u litopys-daemon.service -n 20
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `LITOPYS_DAEMON_STATE` | `~/.litopys/daemon-state.json` | Path to the state file |
| `LITOPYS_DAEMON_SOURCES` | (see below) | JSON array of `{adapter, glob}` objects |
| `LITOPYS_EXTRACTOR_PROVIDER` | `anthropic` | LLM backend: `anthropic`, `openai`, `ollama` |
| `LITOPYS_GRAPH_PATH` | `.litopys/graph` | Graph directory for deduplication |

Default sources:

```json
[
  { "adapter": "claude-code", "glob": "~/.claude/projects/*/*.jsonl" },
  { "adapter": "claude-code", "glob": "~/.claude/projects/*/subagents/*.jsonl" }
]
```

## How it works

1. **Expand globs** — all configured `{adapter, glob}` pairs are resolved to concrete file paths.
2. **Read new bytes** — for each file, read `[byteOffset..fileSize]`. If the file shrank or its mtime went backward (rotation), reset offset to 0.
3. **Parse** — convert the raw bytes to plain text using adapter-specific logic (same rules as `SourceAdapter.read()`).
4. **Extract** — call the LLM extractor on the new text.
5. **Write quarantine** — save candidates for human review (skipped in `--dry-run`).
6. **Persist state** — atomically write the updated offsets to the state file (tmp + rename).
