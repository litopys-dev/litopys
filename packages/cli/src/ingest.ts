import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { loadGraph } from "@litopys/core";
import {
  createAdapter,
  registeredAdapterNames,
  selectAdapter,
  writeQuarantineTo,
} from "@litopys/extractor";
import type { AdapterName, CandidateNode, CandidateRelation } from "@litopys/extractor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestOptions {
  /** LLM provider: anthropic | openai | ollama */
  provider?: string;
  /** If true, do not write to quarantine; only print what would happen. */
  dryRun?: boolean;
  /** Max bytes per chunk before splitting (default: 100 000 ≈ 25k tokens). */
  maxChunkBytes?: number;
  /** Resolved graph directory. */
  graphPath: string;
}

export interface IngestResult {
  filesProcessed: number;
  candidatesFound: number;
  relationsFound: number;
  inputTokensTotal: number;
  outputTokensTotal: number;
  quarantineFiles: string[];
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHUNK_BYTES = 100_000;

/**
 * Run a complete ingest pass for a given source spec.
 * This is the pure-logic layer — no process.stdout/stderr here so it can
 * be called from tests without capturing stdio.
 */
export async function runIngest(spec: string, opts: IngestOptions): Promise<IngestResult> {
  const adapter = selectAdapter(spec);
  if (!adapter) {
    const knownNames = registeredAdapterNames();
    const knownList = knownNames.join(", ");
    const prefixes = knownNames.map((n) => `${n}:`).join(", ");
    throw new Error(
      `No adapter found for spec "${spec}". ` +
        `Known adapters: ${knownList}. ` +
        `Spec must start with one of: ${prefixes}`,
    );
  }

  const files = await adapter.list(spec);
  if (files.length === 0) {
    return {
      filesProcessed: 0,
      candidatesFound: 0,
      relationsFound: 0,
      inputTokensTotal: 0,
      outputTokensTotal: 0,
      quarantineFiles: [],
    };
  }

  // Load existing node ids once (best-effort — graph may not exist yet)
  let existingNodeIds: string[] = [];
  try {
    const loaded = await loadGraph(opts.graphPath);
    existingNodeIds = Array.from(loaded.nodes.keys());
  } catch {
    // Graph doesn't exist yet — that's fine
  }

  const provider = opts.provider ?? process.env.LITOPYS_EXTRACTOR_PROVIDER ?? "anthropic";
  const llmAdapter = createAdapter(provider as AdapterName);
  const maxChunkBytes = opts.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES;
  const quarantineDir = path.join(opts.graphPath, "..", "quarantine");

  let candidatesFound = 0;
  let relationsFound = 0;
  let inputTokensTotal = 0;
  let outputTokensTotal = 0;
  const quarantineFiles: string[] = [];

  for (const filePath of files) {
    const chunk = await adapter.read(filePath);
    const chunks = splitChunk(chunk.text, maxChunkBytes);
    const sessionId =
      chunk.sessionId ??
      `ingest-${createHash("sha256").update(filePath).digest("hex").slice(0, 12)}`;

    const allNodes: CandidateNode[] = [];
    const allRelations: CandidateRelation[] = [];

    for (const chunkText of chunks) {
      const output = await llmAdapter.extract({
        transcript: chunkText,
        existingNodeIds,
        maxCandidates: 20,
      });

      allNodes.push(...output.candidateNodes);
      allRelations.push(...output.candidateRelations);
      inputTokensTotal += output.usage.inputTokens;
      outputTokensTotal += output.usage.outputTokens;
    }

    candidatesFound += allNodes.length;
    relationsFound += allRelations.length;

    if (!opts.dryRun) {
      const timestamp = new Date().toISOString();
      const qPath = await writeQuarantineTo(
        allNodes,
        allRelations,
        {
          sessionId,
          timestamp,
          adapterName: `${llmAdapter.name} (ingest:${adapter.name})`,
        },
        quarantineDir,
      );
      quarantineFiles.push(qPath);
    }
  }

  return {
    filesProcessed: files.length,
    candidatesFound,
    relationsFound,
    inputTokensTotal,
    outputTokensTotal,
    quarantineFiles,
  };
}

// ---------------------------------------------------------------------------
// CLI command handler
// ---------------------------------------------------------------------------

/** Parse raw argv args for the `ingest` subcommand. Returns null and prints usage on error. */
export interface IngestArgs {
  spec: string;
  provider?: string;
  dryRun: boolean;
  maxChunkBytes?: number;
}

export function parseIngestArgs(args: string[]): IngestArgs | null {
  const spec = args[0];
  if (!spec) {
    process.stderr.write("Usage: litopys ingest <spec> [options]\n");
    process.stderr.write("  spec:  <adapter>:<path-or-glob>\n");
    process.stderr.write(`  Adapters: ${registeredAdapterNames().join(", ")}\n`);
    return null;
  }

  let provider: string | undefined;
  let dryRun = false;
  let maxChunkBytes: number | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provider" && args[i + 1]) {
      provider = args[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--max-chunk-bytes" && args[i + 1]) {
      const next = args[++i];
      if (next) {
        const n = Number.parseInt(next, 10);
        if (!Number.isNaN(n) && n > 0) maxChunkBytes = n;
      }
    }
  }

  return { spec, provider, dryRun, maxChunkBytes };
}

/** Full CLI handler for `litopys ingest`. */
export async function cmdIngest(args: string[], graphPath: string): Promise<void> {
  const parsed = parseIngestArgs(args);
  if (!parsed) {
    process.exit(1);
  }

  const { spec, provider, dryRun, maxChunkBytes } = parsed;

  if (dryRun) {
    process.stdout.write(`[dry-run] Would ingest: ${spec}\n`);
  }

  let result: IngestResult;
  try {
    result = await runIngest(spec, { provider, dryRun, maxChunkBytes, graphPath });
  } catch (err) {
    process.stderr.write(`Error: ${String(err)}\n`);
    process.exit(1);
  }

  if (result.filesProcessed === 0) {
    process.stdout.write(`No files matched: ${spec}\n`);
    return;
  }

  // Cost estimate (Haiku defaults: $0.25/M input, $1.25/M output)
  const inputCost = (result.inputTokensTotal / 1_000_000) * 0.25;
  const outputCost = (result.outputTokensTotal / 1_000_000) * 1.25;
  const totalCost = inputCost + outputCost;

  process.stdout.write(`Ingested ${result.filesProcessed} file(s)\n`);
  process.stdout.write(
    `Found ${result.candidatesFound} candidate node(s), ${result.relationsFound} relation(s)\n`,
  );
  process.stdout.write(
    `Tokens: ${result.inputTokensTotal} in / ${result.outputTokensTotal} out — est. cost $${totalCost.toFixed(4)}\n`,
  );

  if (dryRun) {
    process.stdout.write("[dry-run] No quarantine files written.\n");
  } else {
    for (const qPath of result.quarantineFiles) {
      process.stdout.write(`  → ${qPath}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a long text into chunks of at most maxBytes bytes (UTF-8). */
function splitChunk(text: string, maxBytes: number): string[] {
  const encoded = Buffer.from(text, "utf-8");
  if (encoded.length <= maxBytes) return [text];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < encoded.length) {
    // Slice at maxBytes boundary, then back up to a newline to avoid mid-word splits
    let end = Math.min(offset + maxBytes, encoded.length);

    if (end < encoded.length) {
      // Walk back to a newline
      while (end > offset && encoded[end] !== 0x0a) end--;
      if (end === offset) end = offset + maxBytes; // no newline found — hard cut
    }

    chunks.push(encoded.slice(offset, end).toString("utf-8"));
    offset = end;
  }
  return chunks;
}
