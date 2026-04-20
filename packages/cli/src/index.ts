import * as path from "node:path";
import {
  generateDigest,
  listQuarantine,
  promoteCandidate,
  rejectCandidate,
} from "@litopys/extractor";
import { generateStartupContext } from "@litopys/mcp";
import { cmdDaemon } from "./daemon.ts";
import { cmdIngest } from "./ingest.ts";

export const PACKAGE_NAME = "@litopys/cli";
export const VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function graphPath(): string {
  return process.env.LITOPYS_GRAPH_PATH ?? "./.litopys/graph";
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
  quarantine accept <file> <index>          Promote a candidate to the graph
  quarantine reject <file> <index> [reason] Reject a candidate (with audit log)
  digest                                    Generate weekly digest
  startup-context                           Print MCP startup-context markdown (for hooks)

Source adapters:
  text:<path>         Plain text file
  jsonl:<path>        Generic JSONL (one {"role","content"} object per line)
  claude-code:<path>  Claude Code session JSONL (auto-extracts sessionId)

Environment:
  LITOPYS_GRAPH_PATH             Path to the graph directory (default: .litopys/graph)
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
  const indexStr = args[1];
  if (!file || indexStr === undefined) {
    process.stderr.write("Usage: quarantine accept <file> <index>\n");
    process.exit(1);
  }
  const index = Number.parseInt(indexStr, 10);
  if (Number.isNaN(index)) {
    process.stderr.write(`Invalid index: ${indexStr}\n`);
    process.exit(1);
  }

  const absFile = path.resolve(file);
  await promoteCandidate(absFile, index, graphPath());
  process.stdout.write(`Promoted candidate [${index}] from ${path.basename(file)}\n`);
}

async function cmdQuarantineReject(args: string[]): Promise<void> {
  const file = args[0];
  const indexStr = args[1];
  const reason = args[2];
  if (!file || indexStr === undefined) {
    process.stderr.write("Usage: quarantine reject <file> <index> [reason]\n");
    process.exit(1);
  }
  const index = Number.parseInt(indexStr, 10);
  if (Number.isNaN(index)) {
    process.stderr.write(`Invalid index: ${indexStr}\n`);
    process.exit(1);
  }

  const absFile = path.resolve(file);
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
