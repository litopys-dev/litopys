/**
 * skills-tick.ts — Stage B orchestration (Task 10.1).
 *
 * Runs a single skills-detection tick:
 *   1. listUnclustered — if empty, return early (no LLM calls)
 *   2. clusterEpisodes — LLM groups episodes into named clusters
 *   3. selectDraftable — filter by promotion criteria
 *   4. Dedup against existing drafts in quarantineSkillsDir AND installed skills in skillsDir
 *   5. draftSkill + writeSkillDraft — generate and persist each new draft
 *   6. markClustered — mark episode ids in the store
 *   7. If cfg.notifyCommand is set, notify for each new draft (errors → stderr, never aborts)
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ExtractorAdapter } from "./adapters/types.ts";
import { listUnclustered, markClustered } from "./episode-store.ts";
import type { SkillDetectorConfig } from "./skill-config.ts";
import {
  clusterEpisodes,
  draftSkill,
  normalizeSkillName,
  selectDraftable,
  writeSkillDraft,
} from "./skill-draft.ts";
import type { SkillDraftMeta } from "./skill-draft.ts";
import { listSkillDrafts } from "./skill-quarantine.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SkillsTickOptions {
  episodesDir: string;
  quarantineSkillsDir: string;
  cfg: SkillDetectorConfig;
  adapter: ExtractorAdapter;
}

export interface SkillsTickResult {
  /** Names of newly created draft skills. */
  drafts: string[];
}

/**
 * Run one skills-detection tick.
 *
 * Returns the names of all newly written skill drafts.
 * Never throws — errors from individual draft attempts are logged to stderr
 * and skipped so the rest of the tick continues.
 */
export async function runSkillsTick(opts: SkillsTickOptions): Promise<SkillsTickResult> {
  const { episodesDir, quarantineSkillsDir, cfg, adapter } = opts;

  // --- Stage 1: list unclustered episodes (within last 60 days) ---
  const unclustered = await listUnclustered(episodesDir);

  if (unclustered.length === 0) {
    return { drafts: [] };
  }

  // --- Stage 2: cluster episodes via LLM ---
  const groups = await clusterEpisodes(unclustered, adapter);

  if (groups.length === 0) {
    return { drafts: [] };
  }

  // --- Stage 3: filter to draftable groups ---
  const draftable = selectDraftable(groups, unclustered, cfg);

  if (draftable.length === 0) {
    return { drafts: [] };
  }

  // --- Stage 4: build dedup set (existing drafts + installed skills) ---
  const existingNames = new Set<string>();

  // Existing quarantine drafts
  try {
    const existingDrafts = await listSkillDrafts(quarantineSkillsDir);
    for (const d of existingDrafts) {
      existingNames.add(d.meta.name);
    }
  } catch {
    // quarantineSkillsDir not accessible — treat as empty
  }

  // Installed skills in skillsDir
  try {
    const installedEntries = await fs.readdir(cfg.skillsDir);
    for (const entry of installedEntries) {
      const stat = await fs.stat(path.join(cfg.skillsDir, entry)).catch(() => null);
      if (stat?.isDirectory()) {
        existingNames.add(entry);
      }
    }
  } catch {
    // skillsDir not accessible — treat as empty
  }

  // --- Stage 5 + 6 + 7: draft, write, mark, notify ---
  const newDrafts: string[] = [];

  for (const group of draftable) {
    // Compute the canonical base name (without considering collisions yet)
    const baseName = normalizeSkillName(group.name, []);

    // Skip if base name already exists in quarantine drafts or installed skills
    if (existingNames.has(baseName)) {
      continue;
    }

    // Now compute final name (avoiding collisions with newly created drafts in this run)
    const normalizedName = normalizeSkillName(group.name, [...newDrafts]);

    // Build normalized group (draft prompt uses group.name verbatim)
    const normalizedGroup = { ...group, name: normalizedName };

    // Generate SKILL.md via LLM
    let skillMd: string;
    try {
      skillMd = await draftSkill(normalizedGroup, unclustered, adapter);
    } catch (err) {
      process.stderr.write(
        `[litopys/skills] draftSkill failed for group "${normalizedName}": ${String(err)}\n`,
      );
      continue;
    }

    // Collect unique session ids for the meta
    const groupEpisodes = unclustered.filter((ep) => group.episodeIds.includes(ep.id));
    const sessions = [...new Set(groupEpisodes.map((ep) => ep.sessionId))];

    // Write draft to quarantine
    const meta: SkillDraftMeta = {
      name: normalizedName,
      createdAt: new Date().toISOString(),
      episodeIds: group.episodeIds,
      sessions,
      model: adapter.model,
      status: "pending",
    };

    try {
      await writeSkillDraft(normalizedName, skillMd, meta, quarantineSkillsDir);
    } catch (err) {
      process.stderr.write(
        `[litopys/skills] writeSkillDraft failed for "${normalizedName}": ${String(err)}\n`,
      );
      continue;
    }

    // Mark episodes as clustered (best-effort: error doesn't abort)
    // KNOWN WINDOW: markClustered's read→modify→rename can lose an
    // appendEpisodes write that lands in between (see episode-store.ts) — the
    // skills timer runs independently of the SessionEnd hook/daemon, so this
    // is reachable but bounded: a lost append is re-extracted on the next
    // catch-up pass, no corruption.
    try {
      await markClustered(group.episodeIds, normalizedName, episodesDir);
    } catch (err) {
      process.stderr.write(
        `[litopys/skills] markClustered failed for "${normalizedName}": ${String(err)}\n`,
      );
    }

    newDrafts.push(normalizedName);

    // Notify if configured
    if (cfg.notifyCommand) {
      const message = `Litopys: новый черновик скилла "${normalizedName}" (${group.episodeIds.length} эпизодов, ${sessions.length} сессий). Ревью: litopys skills show ${normalizedName}`;
      try {
        const proc = Bun.spawn(["sh", "-c", `${cfg.notifyCommand} "$1"`, "_", message], {
          stderr: "pipe",
          stdout: "pipe",
        });
        await proc.exited;
        if (proc.exitCode !== 0) {
          const errText = await new Response(proc.stderr).text();
          process.stderr.write(
            `[litopys/skills] notifyCommand failed for "${normalizedName}" (exit ${proc.exitCode}): ${errText.slice(0, 200)}\n`,
          );
        }
      } catch (err) {
        process.stderr.write(
          `[litopys/skills] notifyCommand error for "${normalizedName}": ${String(err)}\n`,
        );
      }
    }
  }

  return { drafts: newDrafts };
}
