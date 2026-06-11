/**
 * episodes.ts — Stage A: extract work episodes from a parsed transcript.
 *
 * Uses adapter.complete() (not extract()) to send the episode-extraction
 * prompt and parse the JSON response into validated Episode objects.
 */

import type { ExtractorAdapter } from "./adapters/types.ts";
import { EpisodeSchema, makeEpisodeId } from "./episode-store.ts";
import type { Episode } from "./episode-store.ts";
import { parseKeyedArray, safeReplace } from "./llm-utils.ts";
import type { ParsedTranscript } from "./transcript-tools.ts";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * Episode extraction prompt — English, strict JSON response.
 * Placeholders: {minToolOps}, {transcript}
 */
export const EPISODE_EXTRACTION_PROMPT = `You analyze a work-session transcript of a coding agent. Identify completed work EPISODES — coherent units of work with a clear goal (e.g. "restart service X and verify logs", "fix failing test Y").
For each episode output: goal (short, in Russian), steps (3-10 generalized imperative steps, Russian), toolOps (count of TOOL: lines belonging to the episode), errorRecovery (true if the solution was found after 2+ failed attempts — look for "→ error" followed by retries), project (best guess from paths/names, else null), tags (2-5 lowercase english).
Skip: trivial Q&A, episodes with toolOps < {minToolOps} unless errorRecovery is true, unfinished work.
If no episodes qualify, return {"episodes":[]}
Respond with JSON only, exactly this shape: {"episodes":[{"goal":"...","steps":["..."],"toolOps":3,"errorRecovery":false,"project":null,"tags":["..."]}]}
TRANSCRIPT:
{transcript}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to parse LLM response text into a raw episodes array.
 * Returns null on parse failure. (Fence-stripping + shape check shared in
 * llm-utils.ts.)
 */
function parseEpisodesResponse(text: string): unknown[] | null {
  return parseKeyedArray(text, "episodes");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract completed work episodes from a parsed transcript using an LLM adapter.
 *
 * - Sends a single complete() call; on JSON parse failure, retries ONCE, then
 *   returns [] without throwing.
 * - Each raw episode is validated with EpisodeSchema.safeParse; invalid items
 *   are skipped (stderr warning) without aborting the batch.
 * - In-batch dedup by id (same goal → same makeEpisodeId): the episode with
 *   the higher toolOps wins (tie: first one).
 * - Post-filter: keeps only episodes where toolOps >= minToolOps OR
 *   errorRecovery === true.
 * - Returns [] immediately (no LLM call) when transcript.text is empty.
 *
 * @param transcript   Parsed transcript from parseClaudeCodeTranscript(). MUST be
 *                     parsed with `{ includeTools: "summary" }` — the prompt relies
 *                     on TOOL: lines for toolOps counting and "→ error" markers for
 *                     errorRecovery detection.
 * @param sessionId    Stable session identifier used for episode id generation.
 * @param sessionDate  YYYY-MM-DD date derived deterministically from the session
 *                     (NOT from today's date — the same session re-processed in a
 *                     different month must produce the same episode.date so that
 *                     appendEpisodes() deduplication by id+month-file works correctly).
 * @param adapter      LLM adapter providing complete().
 * @param opts         Extraction options.
 * @param opts.minToolOps  Minimum toolOps count to include an episode (unless
 *                         errorRecovery is true).
 */
export async function extractEpisodes(
  transcript: ParsedTranscript,
  sessionId: string,
  sessionDate: string,
  adapter: ExtractorAdapter,
  opts: { minToolOps: number },
): Promise<Episode[]> {
  // Short-circuit: empty transcript → no LLM call
  if (!transcript.text.trim()) {
    return [];
  }

  // safeReplace uses a function replacer, disabling $-pattern expansion
  // ($&, $', $`) — Bash gists in transcripts often contain $.
  const prompt = safeReplace(
    EPISODE_EXTRACTION_PROMPT.replace("{minToolOps}", String(opts.minToolOps)),
    "{transcript}",
    transcript.text,
  );

  // First attempt — AdapterCompleteError propagates immediately (no retry for API failures)
  const firstResult = await adapter.complete({ prompt, maxTokens: 4096 });
  let rawEpisodes = parseEpisodesResponse(firstResult.text);

  // Retry once on parse failure (response received but not parseable as JSON episodes)
  if (rawEpisodes === null) {
    process.stderr.write(
      `[litopys/episodes] Failed to parse episode response, retrying once: ${firstResult.text.slice(0, 200)}\n`,
    );
    // Second call: if the API is down this throws AdapterCompleteError — propagate,
    // don't waste quota on further retries
    const retryResult = await adapter.complete({ prompt, maxTokens: 4096 });
    rawEpisodes = parseEpisodesResponse(retryResult.text);

    // If still unparseable after retry, give up and return empty
    if (rawEpisodes === null) {
      process.stderr.write(
        `[litopys/episodes] Retry also failed to parse, giving up: ${retryResult.text.slice(0, 200)}\n`,
      );
      return [];
    }
  }

  // Validate each episode element individually
  const episodes: Episode[] = [];
  for (const raw of rawEpisodes) {
    if (raw === null || typeof raw !== "object") {
      process.stderr.write("[litopys/episodes] skipping non-object episode item\n");
      continue;
    }

    // Build the full Episode structure from raw LLM output
    const rawObj = raw as Record<string, unknown>;
    const candidate = {
      id: makeEpisodeId(sessionId, String(rawObj.goal ?? "")),
      sessionId,
      date: sessionDate,
      goal: rawObj.goal,
      steps: rawObj.steps,
      toolOps: rawObj.toolOps,
      errorRecovery: rawObj.errorRecovery,
      project: rawObj.project ?? null,
      tags: rawObj.tags ?? [],
      clusteredInto: null,
    };

    const result = EpisodeSchema.safeParse(candidate);
    if (!result.success) {
      process.stderr.write(
        `[litopys/episodes] skipping invalid episode (goal="${rawObj.goal}"): ${result.error.message}\n`,
      );
      continue;
    }

    episodes.push(result.data);
  }

  // In-batch dedup by id: two episodes with the same goal yield the same
  // makeEpisodeId — keep the one with higher toolOps (tie: first wins).
  const byId = new Map<string, Episode>();
  for (const ep of episodes) {
    const existing = byId.get(ep.id);
    if (existing === undefined || ep.toolOps > existing.toolOps) {
      byId.set(ep.id, ep);
    }
  }

  // Post-filter: keep if toolOps >= minToolOps OR errorRecovery
  return [...byId.values()].filter((ep) => ep.toolOps >= opts.minToolOps || ep.errorRecovery);
}
