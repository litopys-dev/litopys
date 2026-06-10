#!/usr/bin/env bun
/**
 * Litopys SessionEnd hook — reads Claude Code SessionEnd JSON from stdin,
 * extracts knowledge candidates from the transcript, writes to quarantine.
 *
 * Usage (in .claude/settings.json):
 *   "hooks": { "SessionEnd": [{ "command": "bun /path/to/session-end.ts" }] }
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { defaultGraphPath, loadGraph } from "@litopys/core";
import { createAdapter } from "./adapters/factory.ts";
import { writeQuarantine } from "./quarantine.ts";
import { appendEpisodes, defaultEpisodesDir } from "./episode-store.ts";
import { extractEpisodes } from "./episodes.ts";
import { parseClaudeCodeTranscript, sessionDateFromTranscript } from "./transcript-tools.ts";
import type { ExtractorAdapter } from "./adapters/types.ts";

// ---------------------------------------------------------------------------
// Claude Code SessionEnd hook payload shape
// ---------------------------------------------------------------------------

interface SessionEndPayload {
  session_id?: string;
  transcript_path?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 60_000;

/** Mutable context shared between run() and doExtract() across the timeout race. */
interface ExtractContext {
  quarantineWritten: boolean;
}

/**
 * Decide whether a run() failure should produce a failed stub.
 *
 * Stub contract: a failed stub means "the main extraction was NOT persisted to
 * quarantine" (so the daemon re-processes the session). If quarantine was
 * already written, the failure happened in the best-effort episode stage (or
 * later) — writing a stub would falsely mark a successful extraction as
 * failed. In that case we only log; the daemon catches up on episodes.
 *
 * Pure helper, exported for unit tests.
 *
 * @param quarantineWritten  Whether writeQuarantine already succeeded.
 * @param reason             Failure reason ("timeout" or an error message).
 * @returns writeStub flag + the stderr line to emit (null when the timeout
 *          timer callback already logged).
 */
export function decideFailedStub(
  quarantineWritten: boolean,
  reason: string,
): { writeStub: boolean; logLine: string | null } {
  if (quarantineWritten) {
    return {
      writeStub: false,
      logLine:
        `[litopys/session-end] ${reason} after quarantine write — ` +
        `episode stage incomplete, daemon will catch up\n`,
    };
  }
  return {
    writeStub: true,
    // The timeout timer callback already logged its own message
    logLine:
      reason === "timeout" ? null : `[litopys/session-end] Extraction failed: ${reason}\n`,
  };
}

async function run(): Promise<void> {
  // Read JSON from stdin (Claude Code sends the hook payload here)
  let raw = "";
  try {
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
  } catch {
    raw = "";
  }

  let payload: SessionEndPayload = {};
  try {
    payload = JSON.parse(raw) as SessionEndPayload;
  } catch {
    process.stderr.write("[litopys/session-end] Failed to parse stdin JSON, using empty payload\n");
  }

  const sessionId = payload.session_id ?? `session-${Date.now()}`;
  const transcriptPath = payload.transcript_path;
  const graphPath = defaultGraphPath();

  // Wrapped in a timeout so we don't block session close
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    process.stderr.write(`[litopys/session-end] Timeout after ${TIMEOUT_MS}ms\n`);
    timeoutController.abort();
  }, TIMEOUT_MS);

  // doExtract flips quarantineWritten as soon as writeQuarantine succeeds, so
  // a later failure (e.g. timeout during the episode stage) does not produce
  // a failed stub for an extraction that was in fact persisted.
  const ctx: ExtractContext = { quarantineWritten: false };

  try {
    await Promise.race([
      doExtract(sessionId, transcriptPath, graphPath, ctx),
      new Promise<never>((_, reject) => {
        timeoutController.signal.addEventListener("abort", () => {
          reject(new Error("timeout"));
        });
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const decision = decideFailedStub(ctx.quarantineWritten, message);
    if (decision.logLine !== null) {
      process.stderr.write(decision.logLine);
    }
    if (decision.writeStub) {
      await writeFailedStub(graphPath, sessionId, message);
    }
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function doExtract(
  sessionId: string,
  transcriptPath: string | undefined,
  graphPath: string,
  ctx: ExtractContext,
): Promise<void> {
  // Read transcript
  let transcript = "";
  if (transcriptPath) {
    try {
      transcript = await fs.readFile(transcriptPath, "utf-8");
    } catch (err) {
      process.stderr.write(
        `[litopys/session-end] Could not read transcript from ${transcriptPath}: ${String(err)}\n`,
      );
    }
  } else {
    process.stderr.write(
      "[litopys/session-end] No transcript_path in payload, extracting from empty transcript\n",
    );
  }

  // Load existing node ids
  let existingNodeIds: string[] = [];
  try {
    const loaded = await loadGraph(graphPath);
    existingNodeIds = Array.from(loaded.nodes.keys());
  } catch {
    // Graph might not exist yet — that's fine
  }

  const provider = process.env.LITOPYS_EXTRACTOR_PROVIDER ?? "anthropic";
  const adapter = createAdapter(provider);
  const output = await adapter.extract({
    transcript,
    existingNodeIds,
    maxCandidates: 20,
  });

  const timestamp = new Date().toISOString();
  await writeQuarantine(output.candidateNodes, output.candidateRelations, {
    sessionId,
    timestamp,
    adapterName: adapter.name,
  });
  // Main extraction persisted — any failure from here on (episode stage,
  // logging) must NOT produce a failed stub.
  ctx.quarantineWritten = true;

  // Episode extraction stage — best-effort, never throws
  try {
    const written = await runEpisodeStage(transcript, sessionId, adapter);
    if (written > 0) {
      process.stderr.write(
        `[litopys/episodes] Wrote ${written} episode(s) for session ${sessionId}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `[litopys/episodes] Unexpected error in episode stage (session ${sessionId}): ${String(err)}\n`,
    );
  }

  // Cost estimate (Haiku: ~$0.25/M input, ~$1.25/M output)
  const inputCost = (output.usage.inputTokens / 1_000_000) * 0.25;
  const outputCost = (output.usage.outputTokens / 1_000_000) * 1.25;
  const totalCost = inputCost + outputCost;

  process.stderr.write(
    `[litopys/session-end] Extracted ${output.candidateNodes.length} candidates, ` +
      `${output.candidateRelations.length} relations, ` +
      `cost $${totalCost.toFixed(4)} (${output.usage.inputTokens}in/${output.usage.outputTokens}out tokens)\n`,
  );
}

// ---------------------------------------------------------------------------
// Episode stage
// ---------------------------------------------------------------------------

/**
 * Parse the raw transcript, extract work episodes using the LLM adapter, and
 * append them to the monthly JSONL episode store.
 *
 * This function is deliberately best-effort: any internal error (LLM failure,
 * write error, schema validation) is caught, logged to stderr with the
 * `[litopys/episodes]` prefix, and results in a return value of 0. It never
 * throws, so callers that already completed earlier stages are unaffected.
 *
 * @param transcriptRaw  Raw JSONL transcript text.
 * @param sessionId      Stable session identifier.
 * @param adapter        LLM adapter (reused from doExtract).
 * @param opts.minToolOps  Minimum tool operations for an episode to qualify (default: 5).
 * @param opts.episodesDir  Directory where monthly .jsonl files are stored (default: defaultEpisodesDir()).
 * @returns Number of episodes actually written (0 on any error or no qualifying episodes).
 */
export async function runEpisodeStage(
  transcriptRaw: string,
  sessionId: string,
  adapter: ExtractorAdapter,
  opts?: { minToolOps?: number; episodesDir?: string },
): Promise<number> {
  try {
    const minToolOps = opts?.minToolOps ?? 5;
    const episodesDir = opts?.episodesDir ?? defaultEpisodesDir();

    const parsed = parseClaudeCodeTranscript(transcriptRaw, { includeTools: "summary" });

    // Short-circuit: empty transcript → no LLM call, nothing to write
    if (!parsed.text.trim()) {
      return 0;
    }

    // Derive session date deterministically from the transcript content.
    // Falls back to today's date if no timestamp found — this is a degraded
    // mode: re-processing in a different month could produce a different date
    // and write a duplicate to a different monthly file. Log a warning.
    let sessionDate = sessionDateFromTranscript(transcriptRaw);
    if (sessionDate === undefined) {
      sessionDate = new Date().toISOString().slice(0, 10);
      process.stderr.write(
        `[litopys/episodes] No timestamp found in transcript for session ${sessionId}, ` +
          `falling back to today (${sessionDate}) — determinism broken, dedup may be incomplete\n`,
      );
    }

    const episodes = await extractEpisodes(parsed, sessionId, sessionDate, adapter, { minToolOps });

    if (episodes.length === 0) {
      return 0;
    }

    return await appendEpisodes(episodes, episodesDir);
  } catch (err) {
    process.stderr.write(
      `[litopys/episodes] Episode stage failed for session ${sessionId}: ${String(err)}\n`,
    );
    return 0;
  }
}

async function writeFailedStub(
  graphPath: string,
  sessionId: string,
  reason: string,
): Promise<void> {
  const dir = path.join(graphPath, "..", "quarantine", "failed");
  try {
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${new Date().toISOString().replace(/:/g, "-")}-${sessionId}.json`;
    await fs.writeFile(
      path.join(dir, fileName),
      JSON.stringify({ sessionId, reason, timestamp: new Date().toISOString() }, null, 2),
      "utf-8",
    );
  } catch (err) {
    process.stderr.write(`[litopys/session-end] Could not write failed stub: ${String(err)}\n`);
  }
}

// Entrypoint guard: only run the hook when executed directly as a script
// (bun session-end.ts). Importing this module (tests, index.ts re-export of
// runEpisodeStage) must have NO side effects — without this guard every
// import would read stdin, attempt a real extraction against the real graph
// and write failed stubs into ~/.litopys/quarantine/failed/.
if (import.meta.main) {
  run().catch((err) => {
    process.stderr.write(`[litopys/session-end] Fatal error: ${String(err)}\n`);
    process.exit(1);
  });
}
