import { promises as fs } from "node:fs";
import * as path from "node:path";
import { defaultGraphPath } from "@litopys/core";
import {
  acceptMergeProposal,
  generateDigest,
  isMergeProposalContent,
  listQuarantine,
  promoteCandidate,
  rejectCandidate,
  rejectMergeProposal,
} from "@litopys/extractor";
import { generateStartupContext } from "@litopys/mcp";
import { cmdCheck } from "./check.ts";
import { cmdDaemon } from "./daemon.ts";
import { cmdExport } from "./export.ts";
import { cmdImport } from "./import.ts";
import { cmdIngest } from "./ingest.ts";
import { cmdMcp } from "./mcp.ts";
import { cmdProposeMerge } from "./propose-merge.ts";
import { cmdSimilar } from "./similar.ts";
import { cmdViewer } from "./viewer.ts";

export const PACKAGE_NAME = "@litopys/cli";
export const VERSION = "0.1.2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function graphPath(): string {
  return defaultGraphPath();
}

function usage(): void {
  process.stderr.write(`litopys CLI v${VERSION}

Commands:
  ingest <spec> [options]                   Ingest a transcript into quarantine
    <spec>  <adapter>:<path-or-glob>        e.g. text:/tmp/chat.txt
    --provider <anthropic|openai|ollama>    Override LLM provider
    --dry-run                               Print what would be written, skip quarantine
    --max-chunk-bytes <N>                   Split large files (default: 100000)

  daemon tick [--dry-run] [--provider N]   Run one incremental tick (for systemd timer)
  daemon status                            Show daemon state file
  daemon reset [path]                      Reset byte offset(s)

  quarantine list                           List all pending quarantine items
  quarantine accept <file> [index]          Promote a candidate, or accept a merge proposal
  quarantine reject <file> [index] [reason] Reject a candidate, or reject a merge proposal
  digest                                    Generate weekly digest
  startup-context                           Print MCP startup-context markdown (for hooks)

  similar <id> [--explain]                  Find deterministic merge candidates for a node
    --explain                               Show per-reason scoring breakdown
    --limit N                               Max results (default: 10)
    --min-score F                           Minimum score 0..1 (default: 0.35)

  propose-merge <id-a> <id-b>               Write a merge proposal to quarantine for review

  mcp stdio                                 Run MCP server over stdio (Claude Code, etc.)
  mcp http [--port N]                       Run MCP server over HTTP/SSE (remote clients)

  viewer [--port N] [--no-open]             Run the local web dashboard (default port 3999)
  viewer install [--port N]                 Install + enable systemd user unit for autostart
  viewer uninstall                          Stop and remove the systemd user unit

  check [--json]                            Validate graph integrity (broken refs, duplicate
                                            ids, wrong relation types). Exits 1 if issues.

  export [--pretty] [--no-body]             Dump the entire graph (nodes + resolved edges) as
                                            JSON to stdout. Pipe to a file for backup or feed
                                            to external tools.
    --pretty                                Indent output with 2 spaces (default: compact)
    --no-body                               Omit markdown bodies (metadata-only snapshot)

  import <file.json> [--force] [--dry-run]  Restore nodes from a JSON snapshot produced by
                                            'litopys export'. By default new nodes are created
                                            and existing ids are skipped — pass --force to
                                            overwrite them. Use --dry-run to preview the plan
                                            without touching the graph.

Source adapters:
  text:<path>         Plain text file
  jsonl:<path>        Generic JSONL (one {"role","content"} object per line)
  claude-code:<path>  Claude Code session JSONL (auto-extracts sessionId)

Environment:
  LITOPYS_GRAPH_PATH             Path to the graph directory (default: ~/.litopys/graph)
  LITOPYS_EXTRACTOR_PROVIDER     LLM provider: anthropic | openai | ollama (default: anthropic)
  LITOPYS_DAEMON_STATE           Override daemon state file path
  LITOPYS_DAEMON_SOURCES         JSON array of {adapter,glob} source configs
`);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function cmdQuarantineList(): Promise<void> {
  const pending = await listQuarantine(graphPath());

  if (pending.length === 0) {
    process.stdout.write("No pending quarantine items.\n");
    return;
  }

  for (const f of pending) {
    const content = await fs.readFile(f.filePath, "utf-8").catch(() => "");
    if (isMergeProposalContent(content)) {
      process.stdout.write(`\nFile: ${f.filePath}  [merge-proposal]\n`);
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch?.[1]) {
        for (const line of fmMatch[1].split("\n")) {
          const trimmed = line.trim();
          if (trimmed) process.stdout.write(`  ${trimmed}\n`);
        }
      }
      continue;
    }

    process.stdout.write(`\nFile: ${f.filePath}\n`);
    process.stdout.write(`  Session: ${f.meta.sessionId}\n`);
    process.stdout.write(`  Timestamp: ${f.meta.timestamp}\n`);
    process.stdout.write(`  Adapter: ${f.meta.adapterName}\n`);
    process.stdout.write(`  Candidates (${f.candidates.length}):\n`);
    f.candidates.forEach((c, i) => {
      process.stdout.write(
        `    [${i}] [${c.type}] ${c.id} — ${c.summary} (confidence: ${c.confidence})\n`,
      );
      process.stdout.write(`         Reasoning: ${c.reasoning}\n`);
    });
    if (f.relations.length > 0) {
      process.stdout.write(`  Relations (${f.relations.length}):\n`);
      f.relations.forEach((r, i) => {
        process.stdout.write(`    [${i}] ${r.sourceId} --[${r.type}]--> ${r.targetId}\n`);
      });
    }
  }
}

async function cmdQuarantineAccept(args: string[]): Promise<void> {
  const file = args[0];
  if (!file) {
    process.stderr.write("Usage: quarantine accept <file> [index]\n");
    process.exit(1);
  }

  const absFile = path.resolve(file);

  // Detect file type — merge proposals have their own accept pipeline
  const content = await fs.readFile(absFile, "utf-8");
  if (isMergeProposalContent(content)) {
    const result = await acceptMergeProposal(absFile, graphPath());
    const conflictPart =
      result.conflictsIgnored > 0 ? ` (${result.conflictsIgnored} conflicts noted)` : "";
    process.stdout.write(
      `Applied merge proposal ${path.basename(file)}: ${result.loserId} → ${result.winnerId}${conflictPart}\n`,
    );
    return;
  }

  const indexStr = args[1];
  if (indexStr === undefined) {
    process.stderr.write("Usage: quarantine accept <candidate-file> <index>\n");
    process.exit(1);
  }
  const index = Number.parseInt(indexStr, 10);
  if (Number.isNaN(index)) {
    process.stderr.write(`Invalid index: ${indexStr}\n`);
    process.exit(1);
  }

  await promoteCandidate(absFile, index, graphPath());
  process.stdout.write(`Promoted candidate [${index}] from ${path.basename(file)}\n`);
}

async function cmdQuarantineReject(args: string[]): Promise<void> {
  const file = args[0];
  if (!file) {
    process.stderr.write("Usage: quarantine reject <file> [index] [reason]\n");
    process.exit(1);
  }

  const absFile = path.resolve(file);
  const content = await fs.readFile(absFile, "utf-8");
  if (isMergeProposalContent(content)) {
    await rejectMergeProposal(absFile);
    process.stdout.write(`Rejected merge proposal ${path.basename(file)}\n`);
    return;
  }

  const indexStr = args[1];
  const reason = args[2];
  if (indexStr === undefined) {
    process.stderr.write("Usage: quarantine reject <candidate-file> <index> [reason]\n");
    process.exit(1);
  }
  const index = Number.parseInt(indexStr, 10);
  if (Number.isNaN(index)) {
    process.stderr.write(`Invalid index: ${indexStr}\n`);
    process.exit(1);
  }

  await rejectCandidate(absFile, index, graphPath(), reason);
  process.stdout.write(
    `Rejected candidate [${index}] from ${path.basename(file)}${reason ? ` (${reason})` : ""}\n`,
  );
}

async function cmdDigest(): Promise<void> {
  const result = await generateDigest({ graphPath: graphPath() });
  process.stdout.write(`Digest written to: ${result.outputPath}\n`);
  process.stdout.write(`Week: ${result.weekLabel}\n`);
}

async function cmdStartupContext(): Promise<void> {
  const markdown = await generateStartupContext(graphPath());
  process.stdout.write(markdown);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const sub = args[1];

  if (!cmd) {
    usage();
    process.exit(0);
  }

  if (cmd === "ingest") {
    await cmdIngest(args.slice(1), graphPath());
  } else if (cmd === "daemon") {
    await cmdDaemon(args.slice(1), graphPath());
  } else if (cmd === "quarantine") {
    if (sub === "list") {
      await cmdQuarantineList();
    } else if (sub === "accept") {
      await cmdQuarantineAccept(args.slice(2));
    } else if (sub === "reject") {
      await cmdQuarantineReject(args.slice(2));
    } else {
      process.stderr.write(`Unknown quarantine subcommand: ${sub ?? "(none)"}\n`);
      usage();
      process.exit(1);
    }
  } else if (cmd === "digest") {
    await cmdDigest();
  } else if (cmd === "startup-context") {
    await cmdStartupContext();
  } else if (cmd === "similar") {
    await cmdSimilar(args.slice(1), graphPath());
  } else if (cmd === "propose-merge") {
    await cmdProposeMerge(args.slice(1), graphPath());
  } else if (cmd === "mcp") {
    await cmdMcp(args.slice(1));
  } else if (cmd === "viewer") {
    await cmdViewer(args.slice(1));
  } else if (cmd === "check") {
    await cmdCheck(args.slice(1), graphPath());
  } else if (cmd === "export") {
    await cmdExport(args.slice(1), graphPath());
  } else if (cmd === "import") {
    await cmdImport(args.slice(1), graphPath());
  } else {
    process.stderr.write(`Unknown command: ${cmd}\n`);
    usage();
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`Error: ${String(err)}\n`);
    process.exit(1);
  });
}
