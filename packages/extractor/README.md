# @litopys/extractor

Model-agnostic knowledge extractor for Litopys. Integrates with Claude Code's `SessionEnd` hook to automatically extract knowledge candidates from session transcripts using LLMs, then queues them for review in a **quarantine** directory before committing to the graph.

## How It Works

```
Claude Code session ends
        ↓
SessionEnd hook fires
        ↓
session-end.ts reads transcript
        ↓
LLM extracts node + relation candidates
        ↓
Written to quarantine/<timestamp>-<session>.md
        ↓
You review with: litopys quarantine list
        ↓
Accept or reject each candidate
        ↓
Accepted → written to graph
Rejected → logged to quarantine/rejected.jsonl
```

## Enable the SessionEnd Hook

Add to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "command": "bun /path/to/litopys/packages/extractor/src/session-end.ts"
      }
    ]
  }
}
```

See `examples/claude-settings.json` for a ready-to-copy template.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LITOPYS_GRAPH_PATH` | `.litopys/graph` | Path to the graph directory |
| `LITOPYS_EXTRACTOR_PROVIDER` | `anthropic` | LLM provider: `anthropic`, `openai`, or `ollama` |
| `ANTHROPIC_API_KEY` | — | Required for `anthropic` provider |
| `OPENAI_API_KEY` | — | Required for `openai` provider |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |

## Providers

### Anthropic (default)

Uses `claude-haiku-4-5-20251001` by default — fast and cheap.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export LITOPYS_EXTRACTOR_PROVIDER=anthropic
```

### OpenAI

Uses `gpt-4o-mini` by default.

```bash
export OPENAI_API_KEY=sk-...
export LITOPYS_EXTRACTOR_PROVIDER=openai
```

### Ollama (local, free)

No API key needed. Requires Ollama running locally.

```bash
export LITOPYS_EXTRACTOR_PROVIDER=ollama
# Optionally: export OLLAMA_BASE_URL=http://localhost:11434
```

## Cost Estimate

| Provider | Model | Cost per session |
|---|---|---|
| Anthropic | claude-haiku-4-5-20251001 | ~$0.001 |
| OpenAI | gpt-4o-mini | ~$0.002 |
| Ollama | llama3.2 | $0.000 (local) |

A typical 1-hour Claude Code session transcript is ~10k tokens. At Haiku pricing ($0.25/M input, $1.25/M output) this costs under $0.001.

## Review Quarantine

```bash
# List all pending items
bun packages/cli/src/index.ts quarantine list

# Accept a candidate (creates node in graph)
bun packages/cli/src/index.ts quarantine accept /path/to/quarantine/file.md 0

# Reject a candidate (logs to rejected.jsonl)
bun packages/cli/src/index.ts quarantine reject /path/to/quarantine/file.md 0 "not relevant"
```

## Weekly Digest

```bash
# Generate manually
bun packages/cli/src/index.ts digest
# or
bun packages/extractor/src/digest.ts
```

For automatic weekly digests, install the systemd timer:

```bash
cp packages/extractor/systemd/litopys-digest.service /etc/systemd/system/litopys-digest@.service
cp packages/extractor/systemd/litopys-digest.timer /etc/systemd/system/litopys-digest.timer
systemctl enable --now litopys-digest.timer
```

Digests are written to `<graph>/../digests/<YYYY-Www>.md`.

## Example Quarantine File

```markdown
---
sessionId: "abc-123"
timestamp: "2024-01-15T10:00:00.000Z"
adapterName: "anthropic"
candidateCount: 2
relationCount: 1
---

# Quarantine Candidates

json
{
  "candidates": [
    {
      "id": "typescript-strict-mode",
      "type": "concept",
      "summary": "TypeScript strict mode enables noUncheckedIndexedAccess etc.",
      "confidence": 0.92,
      "reasoning": "Alice explicitly stated she prefers strict TypeScript throughout the session"
    }
  ],
  "relations": [
    {
      "type": "prefers",
      "sourceId": "alice",
      "targetId": "typescript-strict-mode",
      "confidence": 0.9,
      "reasoning": "Person expressed strong preference for strict settings"
    }
  ]
}

```

## Architecture

```
packages/extractor/
├── src/
│   ├── adapters/
│   │   ├── types.ts      # ExtractorAdapter interface + Zod schemas
│   │   ├── anthropic.ts  # Anthropic SDK adapter
│   │   ├── openai.ts     # OpenAI SDK adapter
│   │   ├── ollama.ts     # Plain HTTP fetch adapter (no npm dep)
│   │   └── factory.ts    # createAdapter() factory
│   ├── prompt.ts         # Shared extraction prompt
│   ├── quarantine.ts     # Read/write/promote/reject quarantine files
│   ├── session-end.ts    # Claude Code SessionEnd hook entrypoint
│   └── digest.ts         # Weekly digest generator
├── examples/
│   └── claude-settings.json
└── systemd/
    ├── litopys-digest.service
    └── litopys-digest.timer
```
