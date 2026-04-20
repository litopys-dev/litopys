/**
 * Daemon tick — the core incremental ingestion loop.
 * Called on each timer fire (or manually via `litopys daemon tick`).
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { loadGraph } from "@litopys/core";
import {
  createAdapter,
  writeQuarantineTo,
} from "@litopys/extractor";
import type { AdapterName, CandidateNode, CandidateRelation } from "@litopys/extractor";
import { expandTilde, type SourceConfig } from "./config.ts";
import type { DaemonState, FileState } from "./state.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TickOptions {
  /** Source configs — which globs to expand and which adapters to use. */
  sources: SourceConfig[];
  /** Resolved graph directory. */
  graphPath: string;
  /** LLM provider: anthropic | openai | ollama */
  provider?: string;
  /**
   * Dry-run mode: parse content and update state, but do NOT write to quarantine.
   * Useful for testing that the tick logic works without touching quarantine.
   */
  dryRun?: boolean;
}

export interface FileTickResult {
  filePath: string;
  bytesRead: number;
  candidatesFound: number;
  relationsFound: number;
  quarantineFile?: string;
  skipped: boolean;
  error?: string;
}

export interface TickResult {
  tickedAt: string;
  filesScanned: number;
  filesUpdated: number;
  candidatesTotal: number;
  relationsTotal: number;
  quarantineFiles: string[];
  errors: Array<{ filePath: string; error: string }>;
  fileResults: FileTickResult[];
}

// ---------------------------------------------------------------------------
// Core tick
// ---------------------------------------------------------------------------

/**
 * Run one tick: scan all configured globs, for each file read only the new
 * bytes since last tick, extract candidates, write to quarantine, update state.
 *
 * The `state` object is mutated in place — caller is responsible for persisting it.
 */
export async function runTick(opts: TickOptions, state: DaemonState): Promise<TickResult> {
  const tickedAt = new Date().toISOString();
  const fileResults: FileTickResult[] = [];

  // Expand all configured globs into concrete file paths
  const filePaths = await expandSources(opts.sources);

  // Load existing node ids once for deduplication
  let existingNodeIds: string[] = [];
  try {
    const loaded = await loadGraph(opts.graphPath);
    existingNodeIds = Array.from(loaded.nodes.keys());
  } catch {
    // Graph may not exist yet — fine
  }

  const provider = opts.provider ?? process.env.LITOPYS_EXTRACTOR_PROVIDER ?? "anthropic";
  const llmAdapter = createAdapter(provider as AdapterName);
  const quarantineDir = path.join(opts.graphPath, "..", "quarantine");

  // Process each file — errors are caught per-file
  for (const [filePath, adapterName] of filePaths) {
    const result = await tickFile(filePath, adapterName, {
      state,
      existingNodeIds,
      llmAdapter,
      quarantineDir,
      dryRun: opts.dryRun ?? false,
    });
    fileResults.push(result);
  }

  // Update lastTick
  state.lastTick = tickedAt;

  // Aggregate
  const filesUpdated = fileResults.filter((r) => !r.skipped && !r.error).length;
  const candidatesTotal = fileResults.reduce((s, r) => s + r.candidatesFound, 0);
  const relationsTotal = fileResults.reduce((s, r) => s + r.relationsFound, 0);
  const quarantineFiles = fileResults.flatMap((r) => (r.quarantineFile ? [r.quarantineFile] : []));
  const errors = fileResults
    .filter((r) => r.error !== undefined)
    .map((r) => ({ filePath: r.filePath, error: r.error! }));

  return {
    tickedAt,
    filesScanned: fileResults.length,
    filesUpdated,
    candidatesTotal,
    relationsTotal,
    quarantineFiles,
    errors,
    fileResults,
  };
}

// ---------------------------------------------------------------------------
// Per-file tick
// ---------------------------------------------------------------------------

interface TickFileCtx {
  state: DaemonState;
  existingNodeIds: string[];
  llmAdapter: ReturnType<typeof createAdapter>;
  quarantineDir: string;
  dryRun: boolean;
}

async function tickFile(
  filePath: string,
  adapterName: string,
  ctx: TickFileCtx,
): Promise<FileTickResult> {
  const base: FileTickResult = {
    filePath,
    bytesRead: 0,
    candidatesFound: 0,
    relationsFound: 0,
    skipped: false,
  };

  try {
    // Stat the file
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(filePath);
    } catch {
      // File disappeared between glob and stat — skip
      return { ...base, skipped: true };
    }

    const fileSize = stat.size;
    const currentMtime = stat.mtime.toISOString();

    // Load existing per-file state (or create fresh)
    const prev: FileState | undefined = ctx.state.sources[filePath];

    let byteOffset = 0;

    if (prev !== undefined) {
      // Detect rotation / truncation: file is smaller than our offset,
      // or mtime went backwards (file was replaced with an older copy).
      const mtimePrev = new Date(prev.mtime).getTime();
      const mtimeCurrent = stat.mtime.getTime();
      const truncated = fileSize < prev.byteOffset;
      const rotated = mtimeCurrent < mtimePrev;

      if (truncated || rotated) {
        // Reset — re-read from beginning
        byteOffset = 0;
      } else {
        byteOffset = prev.byteOffset;
      }
    }

    // Nothing new to read
    if (byteOffset >= fileSize) {
      // Update mtime in case it changed (e.g. touch) but content same length
      ctx.state.sources[filePath] = {
        byteOffset,
        mtime: currentMtime,
        adapter: adapterName,
      };
      return { ...base, skipped: true };
    }

    // Read only the new bytes
    const bytesToRead = fileSize - byteOffset;
    const buffer = Buffer.allocUnsafe(bytesToRead);

    const fd = await fs.open(filePath, "r");
    try {
      await fd.read(buffer, 0, bytesToRead, byteOffset);
    } finally {
      await fd.close();
    }

    const newContent = buffer.toString("utf-8");

    // Parse new content with the appropriate adapter logic
    const text = parseContent(newContent, adapterName);

    if (!text.trim()) {
      // Bytes added but no parseable content yet (partial line, binary noise, etc.)
      // Advance offset to avoid re-reading same bytes next tick
      ctx.state.sources[filePath] = {
        byteOffset: fileSize,
        mtime: currentMtime,
        adapter: adapterName,
      };
      return { ...base, skipped: true };
    }

    // Run LLM extraction
    const sessionId = deriveSessionId(filePath, newContent);
    const output = await ctx.llmAdapter.extract({
      transcript: text,
      existingNodeIds: ctx.existingNodeIds,
      maxCandidates: 20,
    });

    const allNodes: CandidateNode[] = output.candidateNodes;
    const allRelations: CandidateRelation[] = output.candidateRelations;

    let quarantineFile: string | undefined;
    if (!ctx.dryRun && (allNodes.length > 0 || allRelations.length > 0)) {
      const timestamp = new Date().toISOString();
      quarantineFile = await writeQuarantineTo(allNodes, allRelations, {
        sessionId,
        timestamp,
        adapterName: `${ctx.llmAdapter.name} (daemon:${adapterName})`,
      }, ctx.quarantineDir);
    }

    // Update state
    ctx.state.sources[filePath] = {
      byteOffset: fileSize,
      mtime: currentMtime,
      adapter: adapterName,
    };

    return {
      ...base,
      bytesRead: bytesToRead,
      candidatesFound: allNodes.length,
      relationsFound: allRelations.length,
      quarantineFile,
    };
  } catch (err) {
    return { ...base, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Content parsing (adapter-specific text extraction from raw bytes)
// ---------------------------------------------------------------------------

/**
 * Convert raw file bytes (from byteOffset onwards) into plain text for the
 * LLM extractor. Uses the same logic as each SourceAdapter.read(), but
 * operating on an arbitrary slice rather than a complete file.
 */
function parseContent(raw: string, adapterName: string): string {
  if (adapterName === "text") {
    return raw;
  }

  if (adapterName === "jsonl") {
    return parseJsonlContent(raw, (obj) => {
      const role = typeof obj["role"] === "string" ? obj["role"].toUpperCase() : null;
      const content = typeof obj["content"] === "string" ? obj["content"] : null;
      if (role && content !== null) return `${role}: ${content}`;
      return null;
    });
  }

  if (adapterName === "claude-code") {
    return parseJsonlContent(raw, (obj) => {
      const type = obj["type"];
      if (type !== "user" && type !== "assistant") return null;

      const msg = obj["message"] as Record<string, unknown> | undefined;
      if (!msg) return null;

      const role =
        typeof msg["role"] === "string" ? msg["role"].toUpperCase() : String(type).toUpperCase();
      const text = extractClaudeCodeText(
        msg["content"] as string | Array<Record<string, unknown>> | undefined,
      );
      if (text) return `${role}: ${text}`;
      return null;
    });
  }

  // Unknown adapter — treat as plain text
  return raw;
}

function parseJsonlContent(
  raw: string,
  extractor: (obj: Record<string, unknown>) => string | null,
): string {
  const parts: string[] = [];
  // Only process complete lines (last incomplete line is left for next tick)
  const lastNewline = raw.lastIndexOf("\n");
  const safeRaw = lastNewline >= 0 ? raw.slice(0, lastNewline) : "";

  for (const line of safeRaw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const text = extractor(obj);
      if (text) parts.push(text);
    } catch {
      // Skip non-JSON / partial lines
    }
  }

  return parts.join("\n\n");
}

function extractClaudeCodeText(
  content: string | Array<Record<string, unknown>> | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content.trim();

  const texts: string[] = [];
  for (const block of content) {
    if (block["type"] === "text" && typeof block["text"] === "string") {
      texts.push((block["text"] as string).trim());
    }
    // Skip thinking, tool_use, tool_result
  }
  return texts.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand all configured sources into (filePath, adapterName) pairs. */
async function expandSources(sources: SourceConfig[]): Promise<Array<[string, string]>> {
  const result: Array<[string, string]> = [];
  for (const src of sources) {
    const pattern = expandTilde(src.glob);
    const paths = await expandGlobPattern(pattern);
    for (const p of paths) {
      result.push([p, src.adapter]);
    }
  }
  return result;
}

/** Expand a glob pattern into concrete file paths (copy of extractor's expandGlob). */
async function expandGlobPattern(pattern: string): Promise<string[]> {
  const { glob } = await import("node:fs/promises");

  if (/[*?{}\[\]]/.test(pattern)) {
    try {
      const matches: string[] = [];
      const parts = pattern.split("/");
      let baseDir = "/";
      let relPattern = pattern;

      const firstGlobIdx = parts.findIndex((p) => /[*?{}\[\]]/.test(p));
      if (firstGlobIdx > 0) {
        baseDir = parts.slice(0, firstGlobIdx).join("/") || "/";
        relPattern = parts.slice(firstGlobIdx).join("/");
      }

      for await (const match of glob(relPattern, { cwd: baseDir })) {
        matches.push(path.join(baseDir, match));
      }
      return matches.sort();
    } catch {
      return [];
    }
  }

  try {
    await fs.access(pattern);
    return [pattern];
  } catch {
    return [];
  }
}

/** Derive a stable session id from the file path + content hash. */
function deriveSessionId(filePath: string, content: string): string {
  const hash = createHash("sha256")
    .update(filePath)
    .update(content.slice(0, 256)) // Use a prefix for speed
    .digest("hex")
    .slice(0, 12);
  return `daemon-${hash}`;
}
