/**
 * skill-draft.ts — Stage B: cluster episodes and generate SKILL.md drafts.
 *
 * Provides:
 *  - clusterEpisodes()   — LLM groups episodes into named clusters
 *  - selectDraftable()   — filters groups that meet promotion criteria
 *  - draftSkill()        — generates SKILL.md text from a group
 *  - normalizeSkillName() — sanitizes a skill name to kebab-case
 *  - writeSkillDraft()   — writes SKILL.md + meta.json to quarantine dir
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { Episode } from "./episode-store.ts";
import type { ExtractorAdapter } from "./adapters/types.ts";
import type { SkillDetectorConfig } from "./skill-config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpisodeGroup {
  name: string;
  episodeIds: string[];
  worthSkill: boolean;
  reason: string;
}

export interface SkillDraftMeta {
  name: string;
  createdAt: string;
  episodeIds: string[];
  sessions: string[];
  model: string;
  status: "pending";
}

// ---------------------------------------------------------------------------
// Zod schema for per-item validation
// ---------------------------------------------------------------------------

const EpisodeGroupSchema = z.object({
  name: z.string().min(1),
  episodeIds: z.array(z.string()),
  worthSkill: z.boolean(),
  reason: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * Clustering prompt — English, strict JSON response.
 * Placeholder: {episodes}
 */
export const CLUSTER_PROMPT = `You are given work episodes from different agent sessions. Group episodes that describe the SAME recurring procedure (same goal pattern, similar steps).
Respond JSON only: {"groups":[{"name":"<kebab-case-en>","episodeIds":["..."],"worthSkill":true,"reason":"<1 sentence>"}]}
A group is worthSkill if the procedure is non-trivial and likely to recur. Single-episode groups are allowed. If nothing groups, return {"groups":[]}.
EPISODES:
{episodes}`;

/**
 * Skill draft prompt — generates a ready-to-use SKILL.md document.
 * Placeholders: {name}, {episodes}
 */
export const DRAFT_PROMPT = `You are given a cluster name and a list of work episodes. Generate a SKILL.md skill document.
The document MUST follow this exact structure (respond with the markdown document only, no fences around the whole document):

---
name: {name}
description: <trigger conditions in one paragraph, English>
---

# <Title>

## When to use

## Procedure

## Pitfalls

## Verification

Rules:
- Section bodies in Russian.
- Procedure: numbered generalized steps with concrete commands where they appeared.
- Pitfalls: extract from errorRecovery episodes — what did NOT work.
- Verification: how to confirm the procedure succeeded.

EPISODES:
{episodes}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences from an LLM response if present.
 * Handles ```json ... ```, ```markdown ... ```, and ``` ... ``` wrapping.
 * Also handles fences that wrap the ENTIRE document (Stage B: draftSkill).
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z]*)?\s*\n([\s\S]*?)\n?```\s*$/);
  if (fenceMatch?.[1] !== undefined) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

/**
 * Safe string replacement using a function replacer to avoid $-pattern expansion.
 * Equivalent to .replace(needle, () => replacement).
 */
function safeReplace(template: string, needle: string, replacement: string): string {
  return template.replace(needle, () => replacement);
}

/**
 * Attempt to parse LLM response text into a raw groups array.
 * Returns null on parse failure or wrong shape.
 */
function parseGroupsResponse(text: string): unknown[] | null {
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
    "groups" in (parsed as object) &&
    Array.isArray((parsed as Record<string, unknown>).groups)
  ) {
    return (parsed as Record<string, unknown>).groups as unknown[];
  }
  return null;
}

/**
 * Validate that a SKILL.md string has the required structure:
 * - starts with "---"
 * - contains "name:"
 * - contains all 4 required section headers
 */
function isValidSkillMd(text: string): boolean {
  const t = text.trimStart();
  if (!t.startsWith("---")) return false;
  if (!t.includes("name:")) return false;
  const required = ["## When to use", "## Procedure", "## Pitfalls", "## Verification"];
  return required.every((section) => t.includes(section));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Cluster episodes using an LLM adapter.
 *
 * - Empty input → [] without any LLM call.
 * - Strips code fences from response.
 * - 1 retry on unparseable/wrong-shape response → [] on second failure.
 * - Per-item validation with EpisodeGroupSchema; broken groups skipped with stderr warning.
 * - Hallucinated episodeIds (not in input) filtered from each group.
 * - Groups that become empty after filtering → discarded.
 */
export async function clusterEpisodes(
  episodes: Episode[],
  adapter: ExtractorAdapter,
): Promise<EpisodeGroup[]> {
  if (episodes.length === 0) {
    return [];
  }

  // Build episode payload for the prompt (id, goal, steps, tags, sessionId, errorRecovery, toolOps)
  const episodePayload = episodes.map((ep) => ({
    id: ep.id,
    goal: ep.goal,
    steps: ep.steps,
    tags: ep.tags,
    sessionId: ep.sessionId,
    errorRecovery: ep.errorRecovery,
    toolOps: ep.toolOps,
  }));

  const prompt = safeReplace(CLUSTER_PROMPT, "{episodes}", JSON.stringify(episodePayload, null, 2));

  // First attempt
  const firstResult = await adapter.complete({ prompt, maxTokens: 2048 });
  let rawGroups = parseGroupsResponse(firstResult.text);

  // Retry once on parse/shape failure
  if (rawGroups === null) {
    process.stderr.write(
      `[litopys/skills] Failed to parse cluster response, retrying once: ${firstResult.text.slice(0, 200)}\n`,
    );
    const retryResult = await adapter.complete({ prompt, maxTokens: 2048 });
    rawGroups = parseGroupsResponse(retryResult.text);

    if (rawGroups === null) {
      process.stderr.write(
        `[litopys/skills] Retry also failed to parse cluster response, giving up: ${retryResult.text.slice(0, 200)}\n`,
      );
      return [];
    }
  }

  // Build a set of valid episode ids for hallucination filtering
  const validIds = new Set(episodes.map((ep) => ep.id));

  // Validate each group individually
  const groups: EpisodeGroup[] = [];
  for (const raw of rawGroups) {
    const result = EpisodeGroupSchema.safeParse(raw);
    if (!result.success) {
      const nameHint = raw !== null && typeof raw === "object"
        ? (raw as Record<string, unknown>).name ?? "<unknown>"
        : "<unknown>";
      process.stderr.write(
        `[litopys/skills] skipping invalid group (name="${nameHint}"): ${result.error.message}\n`,
      );
      continue;
    }

    // Filter hallucinated episode ids
    const filteredIds = result.data.episodeIds.filter((id) => validIds.has(id));
    if (filteredIds.length === 0) {
      // All ids were hallucinated — discard the group
      continue;
    }

    groups.push({ ...result.data, episodeIds: filteredIds });
  }

  return groups;
}

/**
 * Filter groups down to those that are worth promoting to SKILL.md drafts.
 *
 * A group is draftable if:
 *   worthSkill === true
 *   AND one of:
 *     a) episodes span >= cfg.minSessions different sessionIds
 *     b) single episode with errorRecovery === true AND toolOps >= cfg.minToolOps
 *
 * Groups that are empty (after hallucination filtering upstream) are discarded.
 */
export function selectDraftable(
  groups: EpisodeGroup[],
  episodes: Episode[],
  cfg: SkillDetectorConfig,
): EpisodeGroup[] {
  const episodeMap = new Map<string, Episode>(episodes.map((ep) => [ep.id, ep]));

  return groups.filter((group) => {
    if (!group.worthSkill) return false;
    if (group.episodeIds.length === 0) return false;

    const groupEpisodes = group.episodeIds
      .map((id) => episodeMap.get(id))
      .filter((ep): ep is Episode => ep !== undefined);

    if (groupEpisodes.length === 0) return false;

    // Check multi-session criterion
    const uniqueSessions = new Set(groupEpisodes.map((ep) => ep.sessionId));
    if (uniqueSessions.size >= cfg.minSessions) return true;

    // Single-episode errorRecovery criterion
    if (groupEpisodes.length === 1) {
      const ep = groupEpisodes[0]!;
      return ep.errorRecovery && ep.toolOps >= cfg.minToolOps;
    }

    return false;
  });
}

/**
 * Generate a SKILL.md draft string for a group of episodes.
 *
 * - Sends a complete() call with the draft prompt.
 * - Strips code fences from the entire document if LLM wraps it.
 * - Validates result: must start with "---", contain "name:", contain all 4 sections.
 * - 1 retry on invalid result; throws on second failure.
 */
export async function draftSkill(
  group: EpisodeGroup,
  episodes: Episode[],
  adapter: ExtractorAdapter,
): Promise<string> {
  const groupEpisodes = episodes.filter((ep) => group.episodeIds.includes(ep.id));

  const episodePayload = groupEpisodes.map((ep) => ({
    id: ep.id,
    goal: ep.goal,
    steps: ep.steps,
    tags: ep.tags,
    sessionId: ep.sessionId,
    errorRecovery: ep.errorRecovery,
    toolOps: ep.toolOps,
  }));

  const prompt = safeReplace(
    safeReplace(DRAFT_PROMPT, "{name}", group.name),
    "{episodes}",
    JSON.stringify(episodePayload, null, 2),
  );

  // First attempt
  const firstResult = await adapter.complete({ prompt, maxTokens: 4096 });
  const firstText = stripCodeFences(firstResult.text);

  if (isValidSkillMd(firstText)) {
    return firstText;
  }

  // Retry once
  process.stderr.write(
    `[litopys/skills] draftSkill: invalid SKILL.md response, retrying once for group "${group.name}"\n`,
  );
  const retryResult = await adapter.complete({ prompt, maxTokens: 4096 });
  const retryText = stripCodeFences(retryResult.text);

  if (isValidSkillMd(retryText)) {
    return retryText;
  }

  throw new Error(
    `[litopys/skills] draftSkill: LLM produced invalid SKILL.md for group "${group.name}" after retry`,
  );
}

/**
 * Normalize a raw skill name to kebab-case.
 *
 * Rules:
 * - Lowercased
 * - Non-[a-z0-9] characters → "-"
 * - Multiple consecutive dashes collapsed to one
 * - Leading/trailing dashes trimmed
 * - Truncated to 64 characters
 * - Empty result after normalization → default base "skill"
 * - Collision with existing names → suffix -2, -3, ...
 */
export function normalizeSkillName(raw: string, existing: string[]): string {
  let name = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  if (!name) {
    name = "skill";
  }

  const existingSet = new Set(existing);
  if (!existingSet.has(name)) {
    return name;
  }

  // Find first available suffix
  let counter = 2;
  while (existingSet.has(`${name}-${counter}`)) {
    counter += 1;
  }
  return `${name}-${counter}`;
}

/**
 * Write a skill draft to disk.
 *
 * Creates:
 *   <quarantineSkillsDir>/<name>/SKILL.md
 *   <quarantineSkillsDir>/<name>/meta.json
 *
 * - Throws if the directory already exists ("draft already exists: <name>").
 * - Returns the path to the draft folder.
 */
export async function writeSkillDraft(
  name: string,
  skillMd: string,
  meta: SkillDraftMeta,
  quarantineSkillsDir: string,
): Promise<string> {
  const draftDir = path.join(quarantineSkillsDir, name);

  // Check if draft already exists
  try {
    await fs.access(draftDir);
    throw new Error(`draft already exists: ${name}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    // ENOENT means it doesn't exist — we can create it
  }

  await fs.mkdir(draftDir, { recursive: true });
  await fs.writeFile(path.join(draftDir, "SKILL.md"), skillMd, "utf-8");
  await fs.writeFile(path.join(draftDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf-8");

  return draftDir;
}
