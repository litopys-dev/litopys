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
import { loadGraph } from "@litopys/core";
import { createAdapter } from "./adapters/factory.ts";
import { writeQuarantine } from "./quarantine.ts";

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
  const graphPath = process.env.LITOPYS_GRAPH_PATH ?? "./.litopys/graph";

  // Wrapped in a timeout so we don't block session close
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    process.stderr.write(
      `[litopys/session-end] Timeout after ${TIMEOUT_MS}ms — writing failed stub\n`,
    );
    timeoutController.abort();
  }, TIMEOUT_MS);

  try {
    await Promise.race([
      doExtract(sessionId, transcriptPath, graphPath),
      new Promise<never>((_, reject) => {
        timeoutController.signal.addEventListener("abort", () => {
          reject(new Error("timeout"));
        });
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "timeout") {
      await writeFailedStub(graphPath, sessionId, "timeout");
    } else {
      process.stderr.write(`[litopys/session-end] Extraction failed: ${message}\n`);
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

run().catch((err) => {
  process.stderr.write(`[litopys/session-end] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
