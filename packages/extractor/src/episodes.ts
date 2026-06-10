/**
 * episodes.ts — Stage A: extract work episodes from a parsed transcript.
 *
 * Uses adapter.complete() (not extract()) to send the episode-extraction
 * prompt and parse the JSON response into validated Episode objects.
 */

import { EpisodeSchema, makeEpisodeId } from "./episode-store.ts";
import type { Episode } from "./episode-store.ts";
import type { ExtractorAdapter } from "./adapters/types.ts";
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
Respond with JSON only: {"episodes":[{...}]}
TRANSCRIPT:
{transcript}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences from an LLM response if present.
 * Handles ```json ... ``` and ``` ... ``` wrapping.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  // Match ```json\n...\n``` or ```\n...\n```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch?.[1] !== undefined) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

/**
 * Attempt to parse LLM response text into a raw episodes array.
 * Returns null on parse failure.
 */
function parseEpisodesResponse(text: string): unknown[] | null {
  const stripped = stripCodeFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    "episodes" in (parsed as object) &&
    Array.isArray((parsed as Record<string, unknown>).episodes)
  ) {
    return (parsed as Record<string, unknown>).episodes as unknown[];
  }
  return null;
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
 * - Post-filter: keeps only episodes where toolOps >= minToolOps OR
 *   errorRecovery === true.
 * - Returns [] immediately (no LLM call) when transcript.text is empty.
 *
 * @param transcript   Parsed transcript from parseClaudeCodeTranscript().
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

  // Function replacement disables $-pattern expansion ($&, $', $`) that a
  // string replacement would apply — Bash gists in transcripts often contain $.
  const prompt = EPISODE_EXTRACTION_PROMPT
    .replace("{minToolOps}", String(opts.minToolOps))
    .replace("{transcript}", () => transcript.text);

  // First attempt
  const firstResult = await adapter.complete({ prompt, maxTokens: 4096 });
  let rawEpisodes = parseEpisodesResponse(firstResult.text);

  // Retry once on parse failure
  if (rawEpisodes === null) {
    const retryResult = await adapter.complete({ prompt, maxTokens: 4096 });
    rawEpisodes = parseEpisodesResponse(retryResult.text);
  }

  // If still unparseable after retry, return empty
  if (rawEpisodes === null) {
    return [];
  }

  // Validate each episode element individually
  const episodes: Episode[] = [];
  for (const raw of rawEpisodes) {
    if (raw === null || typeof raw !== "object") {
      process.stderr.write(`[episodes] skipping non-object episode item\n`);
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
        `[episodes] skipping invalid episode (goal="${rawObj.goal}"): ${result.error.message}\n`,
      );
      continue;
    }

    episodes.push(result.data);
  }

  // Post-filter: keep if toolOps >= minToolOps OR errorRecovery
  return episodes.filter(
    (ep) => ep.toolOps >= opts.minToolOps || ep.errorRecovery,
  );
}
