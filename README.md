<div align="center">

# 📜 Litopys

**A living chronicle for your AI.**

Persistent graph-based memory that survives across sessions and clients —
and a skill detector that turns your repeated routines into reusable skills.
Built for Claude Code, Claude Desktop, and any MCP-compatible agent.

**[litopys-dev.github.io/litopys](https://litopys-dev.github.io/litopys/)** — install, screenshots, and quick-start

[![CI](https://github.com/litopys-dev/litopys/actions/workflows/ci.yml/badge.svg)](https://github.com/litopys-dev/litopys/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)

</div>

---

🇺🇦 [Читати українською](./README.uk.md)

## Why Litopys?

Memory systems for AI agents today force a tradeoff: either heavy vector databases with subprocess leaks and ~500 MB RAM footprint, or flat markdown files that don't scale past a few dozen notes.

**Litopys takes a third path:** a typed graph of knowledge stored in plain markdown, served through a thin MCP layer (~75 MB RAM), editable by hand, queryable by both keyword and structure. Litopys means "chronicle" in Ukrainian — because that's exactly what your AI's memory should be: a living record of what it learned about you, when, and why.

And memory is more than facts. An agent that remembers *"the staging server is at 10.0.0.5"* but re-derives *how to deploy to it* from scratch every session is only half-taught. So Litopys keeps two kinds of memory:

| Layer | What it stores | Where it lives |
|---|---|---|
| **Knowledge graph** | Facts: people, projects, systems, decisions, lessons | `~/.litopys/graph/` — markdown nodes + typed edges |
| **Skill detector** | Procedures: routines you've repeated across sessions, drafted as `SKILL.md` files | `~/.litopys/episodes/` → quarantine → your agent's skills directory |

Both layers are review-first: nothing the LLM extracts lands anywhere without passing through a quarantine you control.

## Features

- 🧠 **Typed graph** — 6 node types (person, project, system, concept, event, lesson) with 11 first-class relations
- 🔁 **Skill detector** — watches your sessions for recurring routines and drafts reusable `SKILL.md` files; you review and install with one command (see [Procedural memory](#procedural-memory--the-skill-detector))
- 🕰 **Bi-temporal queries** — every node carries event time (`occurred_at`, `since`, `until`) independent of when the file was last written; ask "what was true on date X?" via the `as_of` parameter (see [docs/temporal-model.md](docs/temporal-model.md))
- 🔌 **MCP-native** — works with Claude Code, Claude Desktop, Cursor, Cline, or any MCP client (see [docs/integrations](docs/integrations))
- 📝 **Markdown-first** — every node is a plain `.md` file with YAML frontmatter. Hand-editable, grep-able, git-versioned
- 🧹 **Graph maintenance** — `litopys evolve` archives tombstoned nodes (with an auditable manifest) and auto-applies high-confidence merge proposals from quarantine (see [docs/memory-evolution.md](docs/memory-evolution.md))
- 🤖 **Model-agnostic extractor** — Anthropic, OpenAI, local Ollama, or any OpenAI-compatible endpoint. Pick by your resource/cost budget (see [Resource footprint](#resource-footprint)). Facts flow through a quarantine so nothing lands unreviewed
- 🌐 **Web dashboard** — browse, search, edit, visualize the graph, review quarantine and skill drafts at `http://localhost:3999`
- 🔐 **Stays local** — graph lives in `~/.litopys/graph/` as files; the server binds to `127.0.0.1` by default; no telemetry

## Dashboard

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="49%" alt="Dashboard — counts by type, live from ~/.litopys/graph">
  <img src="docs/screenshots/graph.png"     width="49%" alt="Graph — typed nodes, directed relations, force-directed layout">
</p>
<p align="center">
  <img src="docs/screenshots/nodes.png"      width="49%" alt="Nodes — searchable table with type filter">
  <img src="docs/screenshots/quarantine.png" width="49%" alt="Quarantine — pending extractor candidates + merge proposals">
</p>

Screenshots taken against a synthetic demo graph bundled in `docs/screenshots/` — not the author's personal notes.

## Status

**[v0.2.0](https://github.com/litopys-dev/litopys/releases/tag/v0.2.0) is out** — bi-temporal model (`occurred_at` / `since` / `until` on every node, `as_of` queries), `litopys evolve` maintenance command, and the `@litopys/bench` benchmark harness — see the [CHANGELOG](./CHANGELOG.md). Prebuilt binaries for Linux / macOS / Windows (x64 + arm64), with SHA-256 checksums verified by `install.sh`.

**New on `main` (unreleased, ships as v0.3.0):** the **skill detector** — a procedural memory layer that mines work episodes from your sessions and drafts `SKILL.md` files for review (CLI `litopys skills`, a dashboard tab, a digest section). Test suite at **874 / 874** pass. Public surfaces (MCP tools, CLI, JSON export `schemaVersion: 1`, on-disk markdown layout) remain backward-compatible.

Core graph, MCP server (5 tools, stdio + HTTP/SSE), extractor + quarantine + weekly digest, timer-daemon, dashboard (read + write + graph viz + quarantine review + skill drafts), identity-resolution guardrails, single-binary build, one-line installer, per-client integration docs — all shipped. See [What's next](#whats-next) for the planned follow-ups.

## Quick Start

One-line install (Linux / macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | sh
```

This downloads a single ~100 MB binary to `~/.local/bin/litopys`, initializes `~/.litopys/graph/` with the required subdirectories, and prints MCP registration hints.

Pin a specific version by placing the assignment **after the pipe** — env vars set before `curl` only scope to `curl` itself, not the piped shell:

```bash
curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | LITOPYS_VERSION=v0.2.0 sh
```

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

## Procedural memory — the skill detector

The knowledge graph remembers *facts*. The skill detector remembers *how you work*.

**The problem it solves.** Watch your own agent sessions for a week and you'll notice the same multi-step routines coming back: "restart that service and verify the logs", "regenerate the client after a schema change", "the dance required to deploy to staging". Claude Code can load such procedures from `SKILL.md` files — but somebody has to *notice* the routine and write the skill. That somebody is usually nobody.

**What it does.** The skill detector watches your transcripts, notices work you've done more than once, and writes the skill draft for you. You review it and install it with one command. Over time your agent gets measurably better at *your* routines — including the hard-won ones where the right approach only emerged after several failed attempts.

### How it works

```
sessions ──► Stage A: episodes ──► Stage B: clustering ──► review ──► installed skill
            (hook / daemon,        (daily timer, LLM       (CLI /      (~/.claude/skills/)
             per transcript)        groups + drafts)        dashboard)
```

- **Stage A — episode extraction.** As the daemon ticks (or the optional SessionEnd hook fires), each cooled-down Claude Code transcript is mined for *episodes*: compact records of "goal + generalized steps + tools used + whether errors had to be worked around". They append to `~/.litopys/episodes/YYYY-MM.jsonl`. Trivial sessions (almost no tool usage, no error recovery) are skipped without spending an LLM call.
- **Stage B — clustering and drafting.** Once a day, `litopys skills tick` asks the LLM to group episodes that describe the same recurring procedure. A group spanning **2+ different sessions** — or a single episode where the solution emerged through error recovery — becomes a draft: a complete `SKILL.md` with trigger description, numbered procedure, pitfalls (taken from what *didn't* work), and verification steps.
- **Review.** Drafts land in `~/.litopys/quarantine/skills/<name>/` and wait. **Nothing installs itself.**

### Reviewing and installing drafts

```bash
litopys skills list                       # pending drafts
litopys skills show restart-staging       # full SKILL.md preview
litopys skills promote restart-staging    # install into ~/.claude/skills/
litopys skills promote restart-staging --force   # overwrite an existing skill
litopys skills reject restart-staging "too specific to one incident"
```

Prefer a UI? The dashboard has a **Skill drafts** tab with the same preview / install / reject flow. The weekly digest lists pending drafts too, and `LITOPYS_SKILLS_NOTIFY_CMD` can ping you (e.g. a Telegram script) the moment a new draft appears.

### Setup

Stage A needs transcript ingestion you probably already run — the [daemon timer](#optional--daemon-for-long-running-transcripts) picks up episodes automatically; a SessionEnd hook covers them immediately at session end. Stage B is one more timer:

```bash
cp packages/extractor/systemd/litopys-skills.{service,timer} ~/.config/systemd/user/
systemctl --user enable --now litopys-skills.timer
# or run a single pass by hand:
litopys skills tick
```

### Configuration

All optional — defaults are sensible:

| Env var | Default | Meaning |
|---|---|---|
| `LITOPYS_SKILLS_DIR` | `~/.claude/skills` | Where `promote` installs skills |
| `LITOPYS_SKILLS_NOTIFY_CMD` | — | Shell command invoked with a message when a new draft appears |
| `LITOPYS_SKILLS_MIN_TOOL_OPS` | `5` | Min tool operations for a session to be considered non-trivial |
| `LITOPYS_SKILLS_MIN_SESSIONS` | `2` | Sessions a cluster must span before it's drafted |
| `LITOPYS_EPISODES_MAX_LLM_FILES` | `10` | Per-tick budget of transcripts sent to the LLM during catch-up |

### Built for flaky quotas

Episode extraction is engineered to survive rate-limited free tiers: API errors abort the pass via a circuit breaker (one failed call, not a retry storm), unprocessed transcripts stay queued for the next tick, and the per-tick budget keeps a large backlog from burning a day's quota in one pass. An LLM outage delays episodes; it never loses them.

### Current limitations

- Episodes are extracted from **Claude Code** transcripts (the `claude-code` source adapter); other transcript formats are a follow-up.
- Draft prose is currently generated with Russian section bodies and English frontmatter (the author's own setup); a language setting is planned — see [What's next](#whats-next).

## Setup recipes

### Optional — daemon for long-running transcripts

Ingests transcript files incrementally on a 5-minute timer; with the skill detector merged it also performs the episodes catch-up pass.

```bash
cp packages/daemon/systemd/litopys-daemon.{service,timer} ~/.config/systemd/user/
systemctl --user enable --now litopys-daemon.timer
```

### Optional — web dashboard autostart

The dashboard (`litopys viewer`) can run as a systemd user service so it comes
back after every reboot.

```bash
litopys viewer install        # generates token, writes unit, enables service
litopys viewer install --lan  # same + binds to 0.0.0.0 for LAN access
systemctl --user status litopys-viewer

# Remove:
litopys viewer uninstall
```

**Access token.** `viewer install` generates a random token automatically and
saves it to `~/.litopys/viewer.token`. The install output prints a ready-to-use
URL with the token embedded:

```
✓ litopys-viewer installed

  Open dashboard:    http://localhost:3999/?token=<token>
  Share with others: http://192.168.1.x:3999/?token=<token>   # --lan only

  Opening the link once saves the token — no re-entry needed.
  Retrieve token later: cat ~/.litopys/viewer.token
```

Opening the URL once saves the token in `localStorage` — no further prompts.
To share write access with someone, send them the URL that includes `?token=…`.
To retrieve the token at any time: `cat ~/.litopys/viewer.token`.

GET endpoints (browse, search, graph view) are always open. Mutating endpoints
(create / edit / delete nodes, quarantine and skill-draft actions) require the token.

Or set `LITOPYS_ENABLE_VIEWER=1` when running `install.sh` to enable it as
part of the one-line install. Requires `loginctl enable-linger $USER` if you
want the dashboard to stay up across logouts.

### Optional — Notion sync

`@litopys/notion-sync` reads your recently edited Notion pages via the Notion REST API, passes them through the configured LLM extractor to identify knowledge candidates, and writes the results to quarantine for review. A state file `~/.litopys/notion-sync.json` tracks the last-sync timestamp so incremental runs only fetch pages modified since the previous sync.

```bash
# Set your Notion integration token
echo 'NOTION_TOKEN=secret_...' >> ~/.litopys/.env

# Run once to test
NOTION_TOKEN=secret_... litopys notion-sync

# Or install as a systemd timer (runs every 6 hours)
cp packages/notion-sync/systemd/litopys-notion-sync.{service,timer} ~/.config/systemd/user/
systemctl --user enable --now litopys-notion-sync.timer
```

Create the integration token at [notion.so/my-integrations](https://www.notion.so/my-integrations) and share the pages or databases you want synced with the integration.

### Extractor — self-hosted OpenAI-compatible endpoints

The extractor supports any OpenAI-compatible server — vLLM, LM Studio, LocalAI, Ollama's `/v1` proxy — via two environment variables:

```bash
LITOPYS_EXTRACTOR_PROVIDER=openai \
LITOPYS_EXTRACTOR_BASE_URL=http://myserver:8080/v1 \
litopys ingest ~/.claude/projects/.../*.jsonl
```

When `LITOPYS_EXTRACTOR_BASE_URL` is set and no API key is provided, authentication is skipped automatically — no dummy key needed. Use `LITOPYS_EXTRACTOR_API_KEY` to pass a key without overwriting the global `OPENAI_API_KEY`.

### Agent skill — richer graph behavior (Claude Code)

The MCP connection gives Claude the 5 tools and 5 baseline rules. For **full graph discipline** — mandatory traversal after every search, `supersedes` chain awareness, write decision tree, temporal tombstoning — install the bundled skill:

```bash
cp -r skills/litopys-memory ~/.claude/skills/
```

Then open `~/.claude/skills/litopys-memory/SKILL.md` and replace the placeholder trigger description with **the actual project and system names from your graph** — run `litopys startup-context` to see them.

Without the skill, Claude Code uses Litopys correctly but shallowly: it searches but rarely traverses edges, and may miss `supersedes` patterns that mark stale nodes.

## Maintenance

### Integrity check

```bash
litopys check           # human-readable report, grouped by error kind
litopys check --json    # { nodeCount, edgeCount, errorCount, errors[] } for CI
```

Loads and resolves the entire graph, then flags broken refs, duplicate ids,
wrong-typed relations, and parse/validation failures. Exits non-zero when
issues are found — drop it into a git pre-push hook or CI step so drift never
lands silently.

### Backing up your graph

Litopys stores everything as plain markdown in `~/.litopys/graph/`, so any tool
that versions files works. Two common approaches:

**Git + private remote** (incremental history, offsite, free):

```bash
cd ~/.litopys
git init
git add graph/ .gitignore README.md
git commit -m "baseline"
gh repo create my-litopys-graph --private --source=. --push
```

From then on, every session-end hook or manual accept leaves your working tree
dirty — periodically `git add -A && git commit -m "sync" && git push` to keep
the backup current. Your graph contains personal facts, so keep the remote
**private**.

**JSON snapshot** (portable, diffable, tool-friendly):

```bash
litopys export > graph.json              # compact
litopys export --pretty > graph.json     # indented, VCS-friendly
litopys export --no-body > meta.json     # metadata only, strip markdown bodies
```

The dump carries `meta` (exportedAt, counts, schemaVersion) plus all nodes
sorted by id and edges sorted by `(from, relation, to)` — deterministic across
runs, so `diff graph-yesterday.json graph-today.json` tells you exactly what
the LLM/daemon added. Feed it to analysis tools, migrate between hosts, or
commit alongside code.

Restore from a snapshot on a fresh host (or after a reinstall):

```bash
litopys import graph.json --dry-run   # preview the plan
litopys import graph.json             # create new nodes, skip existing ones
litopys import graph.json --force     # also overwrite existing ids
```

Default is conservative — existing nodes are never touched unless you pass
`--force`. Every node is validated against the schema up-front, so a corrupt
snapshot aborts before anything lands on disk.

## Resource footprint

Honest numbers from the author's own install (Ubuntu, Bun 1.x). The MCP server is cheap; the extractor is where the bill shows up, and it depends on which adapter you pick.

| Component                    | RAM        | When it costs                         |
|------------------------------|------------|---------------------------------------|
| MCP server (stdio or HTTP)   | ~75 MB     | always, while a client is connected   |
| Viewer / web dashboard       | ~50 MB     | optional, only while running          |
| Extractor — Anthropic / OpenAI | 0 locally | per API call (tokens), no local RAM   |
| Extractor — Ollama + 3B model  | ~2–3 GB   | only during a tick, unloaded after    |
| Extractor — Ollama + 7B model  | ~5 GB     | only during a tick, unloaded after    |

So the minimum resident cost is ~75 MB for the MCP server. Extraction is optional — you can run Litopys read/write-only from your agent and never start the daemon. If you do enable extraction, the local-Ollama route trades cash for RAM; the Anthropic/OpenAI route trades RAM for cents per session. Ollama's `keep_alive` means the 3B/7B figures are transient — the model drops out of RAM a few minutes after the tick finishes.

The skill detector rides the same extractor budget: episode extraction adds roughly one LLM call per non-trivial session, and the daily skills tick costs one clustering call plus one call per drafted skill — zero when there's nothing new.

## Benchmark

`@litopys/bench` is an end-to-end harness that runs Litopys against a dataset of question/answer sessions and scores retrieval against expected node ids. The built-in synthetic dataset (15 questions, deterministic `mock` extractor) yields **Recall@5 = 0.98**, **Precision@5 = 0.32**, **mean latency 4 ms**. The synthetic fixture exists to validate the harness itself; adapters for real industry datasets (LongMemEval, LOCOMO) are a follow-up. See [docs/benchmark.md](docs/benchmark.md) for dataset format, metric definitions, and how to plug in new adapters.

## What's next

- **Skill-draft language setting.** Draft prose currently follows the author's locale (Russian bodies, English frontmatter). A `LITOPYS_SKILLS_LANG` setting — or simply matching the transcript's language — is the next skill-detector increment.
- **Real benchmark adapters.** `@litopys/bench` currently ships only a synthetic 15-question fixture. Next step is concrete adapters for LongMemEval and LOCOMO so the numbers become directly comparable to other memory systems.
- **`litopys evolve --restore`.** The archive manifest (`archive/manifest.jsonl`) records every tombstoned node moved to `archive/` with its original path. A `--restore <id>` flag will replay a single entry in reverse so archived nodes can be brought back without leaving the CLI.
- **Vector search.** Considered and deliberately skipped — the keyword + typed-graph traversal model has been good enough in practice, and adding an embedding index would re-introduce the heavy footprint Litopys was designed to avoid. We'll revisit only if a concrete recall gap on a real benchmark dataset shows up.

## Release history

See [CHANGELOG.md](./CHANGELOG.md). Beyond the [What's next](#whats-next) items above, future work is driven by real-user feedback — open an issue if something pinches.

## Design principles

- **Agent-agnostic.** No hard dependency on any LLM vendor or client. MCP is the only integration point. Ollama is the default extractor; Anthropic/OpenAI are optional adapters. The extractor also supports any self-hosted OpenAI-compatible server (vLLM, LM Studio, LocalAI, Ollama `/v1` proxy) via `LITOPYS_EXTRACTOR_BASE_URL`.
- **Review-first.** Extracted facts wait in quarantine; drafted skills wait in quarantine. The LLM proposes, you decide — nothing writes itself into your memory or your agent's behavior.
- **Portable data.** The graph is plain markdown + YAML frontmatter on disk; episodes are JSONL; skills are standard `SKILL.md` folders. Readable in any editor, versionable in git, greppable from the shell.
- **Light runtime.** ~75 MB RAM for the MCP server. The extractor is out-of-process and runs on your schedule, not on every request — see [Resource footprint](#resource-footprint) for the full cost breakdown across adapters.
- **Opt-in integrations.** Client-specific helpers (hooks, config snippets) live in `docs/integrations/` — you can use Litopys without any of them.

## License

MIT © 2026 Denis Blashchytsia and Litopys contributors.
