/**
 * Daemon tick — the core incremental ingestion loop.
 * Called on each timer fire (or manually via `litopys daemon tick`).
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { loadGraph } from "@litopys/core";
import {
  appendEpisodes,
  createAdapter,
  extractEpisodes,
  parseClaudeCodeTranscript,
  sessionDateFromTranscript,
  writeQuarantineTo,
} from "@litopys/extractor";
import type {
  AdapterName,
  CandidateNode,
  CandidateRelation,
  ExtractorAdapter,
} from "@litopys/extractor";
import { type SourceConfig, expandTilde } from "./config.ts";
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
// Episodes catch-up
//
// NOTE on file size: tick.ts is at its size threshold. When the next pass
// touches this area, split it into tick.ts (incremental ingestion),
// episodes-catchup.ts (this section) and a shared sources.ts
// (expandSources / expandGlobPattern / deriveSessionId).
// ---------------------------------------------------------------------------

export interface EpisodesCatchupOptions {
  /** Source configs — same ones used by runTick. */
  sources: SourceConfig[];
  /** LLM adapter providing complete() for episode extraction. */
  adapter: ExtractorAdapter;
  /** Directory where monthly episode JSONL files are stored. */
  episodesDir: string;
  /**
   * Only process files whose mtime is older than this many ms.
   * Ensures we only process "cooled-down" sessions.
   * Default: 3_600_000 (1 hour).
   */
  minAgeMs?: number;
  /**
   * Minimum number of tool operations for a session to be sent to the LLM.
   * Sessions below this threshold (and errorCount < 2) are marked as
   * processed but skipped without calling the LLM.
   * Default: 5.
   */
  minToolOps?: number;
  /**
   * Dry-run mode: no LLM calls, no episode writes, no episodesState mutation.
   * Returns zero counts. Default: false.
   */
  dryRun?: boolean;
}

export interface EpisodesCatchupResult {
  filesProcessed: number;
  episodesFound: number;
}

/**
 * Episodes catch-up pass — scan all claude-code source files and extract
 * work episodes from "cooled-down" sessions that have not yet been processed.
 *
 * Catches sessions the SessionEnd hook did not process (timeout, crash, hook
 * not installed); sessions already in the episode store are skipped by
 * sessionId before any LLM call is made.
 *
 * Semantics:
 * - Only files with adapterName === "claude-code" are considered.
 * - A file is a "candidate" if:
 *   a) its mtime is at least minAgeMs in the past (session has "cooled down"), AND
 *   b) episodesState[path] is absent OR its recorded mtime != current mtime.
 * - Cheap pre-filter: if parsed.toolOps < minToolOps AND parsed.errorCount < 2,
 *   no LLM call is made — the file is still marked processed (episodesState updated).
 * - sessionId guard: if the target monthly episodes file already contains an
 *   episode with this sessionId (the SessionEnd hook handled the session), the
 *   file is marked processed and the LLM is NOT called.
 * - Otherwise: extract episodes via the LLM adapter and append to episodesDir.
 *   appendEpisodes additionally deduplicates by episode id.
 * - Session date is derived deterministically from transcript timestamps.
 *   Falls back to the file's mtime date (more deterministic than "today" for
 *   cooled-down files).
 * - Per-file errors are logged to stderr with the [litopys/episodes] prefix.
 *   The file is NOT marked processed on error (retry on next tick).
 * - Dry-run: returns zero counts with no LLM calls, no writes and no
 *   episodesState mutation.
 * - This function never throws.
 *
 * The `state` object is mutated in place (state.episodesState is updated).
 * Caller is responsible for persisting state after this function returns.
 */
export async function runEpisodesCatchup(
  opts: EpisodesCatchupOptions,
  state: DaemonState,
): Promise<EpisodesCatchupResult> {
  // Dry-run contract: zero side effects — no LLM calls, no episode writes,
  // no state mutation. Nothing useful to report without doing the work, so
  // return zeros immediately.
  if (opts.dryRun) {
    return { filesProcessed: 0, episodesFound: 0 };
  }

  const minAgeMs = opts.minAgeMs ?? 3_600_000;
  const minToolOps = opts.minToolOps ?? 5;
  const now = Date.now();

  // Ensure episodesState is initialised
  if (!state.episodesState) {
    state.episodesState = {};
  }
  const episodesState = state.episodesState;

  // Expand all sources, keeping only claude-code files
  const allFiles = await expandSources(opts.sources);
  const claudeCodeFiles = allFiles.filter(([, adapterName]) => adapterName === "claude-code");

  let filesProcessed = 0;
  let episodesFound = 0;

  for (const [filePath] of claudeCodeFiles) {
    // Stat the file
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(filePath);
    } catch {
      // File disappeared between glob and stat — skip silently
      continue;
    }

    const currentMtime = stat.mtime.toISOString();
    const fileAgems = now - stat.mtime.getTime();

    // Only process files that have "cooled down"
    if (fileAgems < minAgeMs) {
      continue;
    }

    // Check whether this file was already processed at this mtime
    const prevEpState = episodesState[filePath];
    if (prevEpState !== undefined && prevEpState.mtime === currentMtime) {
      // Already processed at this mtime — skip
      continue;
    }

    // Read the full file
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      process.stderr.write(
        `[litopys/episodes] Could not read file ${filePath}: ${String(err)}\n`,
      );
      // Do NOT mark processed — retry next tick
      continue;
    }

    // Parse the transcript
    let parsed: ReturnType<typeof parseClaudeCodeTranscript>;
    try {
      parsed = parseClaudeCodeTranscript(raw, { includeTools: "summary" });
    } catch (err) {
      process.stderr.write(
        `[litopys/episodes] Failed to parse transcript ${filePath}: ${String(err)}\n`,
      );
      // Do NOT mark processed — retry next tick
      continue;
    }

    // Cheap filter: not enough activity to warrant an LLM call
    if (parsed.toolOps < minToolOps && parsed.errorCount < 2) {
      // Mark processed but skip LLM
      episodesState[filePath] = { mtime: currentMtime };
      filesProcessed++;
      continue;
    }

    // Derive session id and date
    const sessionId = parsed.sessionId ?? deriveSessionId(filePath, raw);
    let sessionDate = sessionDateFromTranscript(raw);
    if (sessionDate === undefined) {
      // Fall back to file mtime date — more deterministic than "today" for
      // cooled-down sessions (a session from last week should not use today's date)
      sessionDate = stat.mtime.toISOString().slice(0, 10);
    }

    // sessionId guard: if the SessionEnd hook already extracted episodes for
    // this session, the target monthly file contains them — skip the LLM call
    // entirely (token economy + Stage B episode counts stay accurate).
    if (await monthlyFileHasSession(opts.episodesDir, sessionDate, sessionId)) {
      episodesState[filePath] = { mtime: currentMtime };
      filesProcessed++;
      continue;
    }

    // Extract and append episodes
    try {
      const episodes = await extractEpisodes(parsed, sessionId, sessionDate, opts.adapter, {
        minToolOps,
      });

      let written = 0;
      if (episodes.length > 0) {
        written = await appendEpisodes(episodes, opts.episodesDir);
        episodesFound += written;
      }
      process.stderr.write(
        `[litopys/episodes] extracted ${written} episode(s) from ${filePath}\n`,
      );
    } catch (err) {
      process.stderr.write(
        `[litopys/episodes] Episode extraction failed for ${filePath}: ${String(err)}\n`,
      );
      // Do NOT mark processed — retry next tick
      continue;
    }

    // Mark processed (both LLM-called and LLM-skipped paths arrive here)
    episodesState[filePath] = { mtime: currentMtime };
    filesProcessed++;
  }

  return { filesProcessed, episodesFound };
}

/**
 * Check whether the monthly episodes file for `sessionDate` already contains
 * an episode with the given sessionId (i.e. the SessionEnd hook — or a
 * previous catch-up — already processed this session).
 *
 * Missing file / unreadable lines → false (no episodes recorded).
 */
async function monthlyFileHasSession(
  episodesDir: string,
  sessionDate: string,
  sessionId: string,
): Promise<boolean> {
  const monthlyFile = path.join(episodesDir, `${sessionDate.slice(0, 7)}.jsonl`);

  let content: string;
  try {
    content = await fs.readFile(monthlyFile, "utf-8");
  } catch {
    return false;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ep = JSON.parse(trimmed) as { sessionId?: unknown };
      if (ep.sessionId === sessionId) return true;
    } catch {
      // Corrupt line — ignore
    }
  }
  return false;
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
  const errors = fileResults.flatMap((r) =>
    r.error !== undefined ? [{ filePath: r.filePath, error: r.error }] : [],
  );

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
      quarantineFile = await writeQuarantineTo(
        allNodes,
        allRelations,
        {
          sessionId,
          timestamp,
          adapterName: `${ctx.llmAdapter.name} (daemon:${adapterName})`,
        },
        ctx.quarantineDir,
      );
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
      const role = typeof obj.role === "string" ? obj.role.toUpperCase() : null;
      const content = typeof obj.content === "string" ? obj.content : null;
      if (role && content !== null) return `${role}: ${content}`;
      return null;
    });
  }

  if (adapterName === "claude-code") {
    return parseJsonlContent(raw, (obj) => {
      const type = obj.type;
      if (type !== "user" && type !== "assistant") return null;

      const msg = obj.message as Record<string, unknown> | undefined;
      if (!msg) return null;

      const role =
        typeof msg.role === "string" ? msg.role.toUpperCase() : String(type).toUpperCase();
      const text = extractClaudeCodeText(
        msg.content as string | Array<Record<string, unknown>> | undefined,
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
    if (block.type === "text" && typeof block.text === "string") {
      texts.push((block.text as string).trim());
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
