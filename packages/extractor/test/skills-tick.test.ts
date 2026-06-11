/**
 * skills-tick.test.ts — Tests for Task 10.2: runSkillsTick orchestration.
 *
 * Uses tmp-dirs and MockAdapter to exercise the full tick cycle without LLM calls.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { MockAdapter } from "../src/adapters/mock.ts";
import type { Episode } from "../src/episode-store.ts";
import { appendEpisodes } from "../src/episode-store.ts";
import type { SkillDetectorConfig } from "../src/skill-config.ts";
import { runSkillsTick } from "../src/skills-tick.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _epCounter = 0;

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  const n = ++_epCounter;
  return {
    id: `ep-tick-${String(n).padStart(4, "0")}`,
    sessionId: `session-tick-${n}`,
    date: "2026-06-10",
    goal: `Tick test goal ${n}`,
    steps: ["step 1", "step 2", "step 3"],
    toolOps: 6,
    errorRecovery: false,
    project: "test-project",
    tags: ["test", "tick"],
    clusteredInto: null,
    ...overrides,
  };
}

/** Minimal valid SKILL.md */
function makeValidSkillMd(name: string): string {
  return `---
name: ${name}
description: Use this skill when doing ${name}.
---

# ${name}

## When to use

Когда нужно выполнить операцию ${name}.

## Procedure

1. Открыть терминал.
2. Выполнить команду.
3. Проверить результат.

## Pitfalls

Не запускать дважды без остановки.

## Verification

Убедиться что процесс завершился с кодом 0.
`;
}

/** Set up a tmp directory structure for the tick test:
 *   <root>/episodes/     ← episodesDir
 *   <root>/qs/skills/    ← quarantineSkillsDir
 *   <root>/skills/       ← cfg.skillsDir (installed skills)
 */
async function mkTickFixture(): Promise<{
  root: string;
  episodesDir: string;
  quarantineSkillsDir: string;
  skillsDir: string;
  cfg: SkillDetectorConfig;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-tick-test-"));
  const episodesDir = path.join(root, "episodes");
  const quarantineSkillsDir = path.join(root, "qs", "skills");
  const skillsDir = path.join(root, "skills");

  await fs.mkdir(episodesDir, { recursive: true });
  await fs.mkdir(quarantineSkillsDir, { recursive: true });
  await fs.mkdir(skillsDir, { recursive: true });

  const cfg: SkillDetectorConfig = {
    skillsDir,
    notifyCommand: null,
    minToolOps: 5,
    minSessions: 2,
  };

  return { root, episodesDir, quarantineSkillsDir, skillsDir, cfg };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSkillsTick", () => {
  test("no unclustered episodes → returns {drafts:[]} with zero LLM calls", async () => {
    const { root, episodesDir, quarantineSkillsDir, cfg } = await mkTickFixture();
    try {
      const adapter = new MockAdapter({ completions: ['{"groups":[]}'] });
      const result = await runSkillsTick({ episodesDir, quarantineSkillsDir, cfg, adapter });

      expect(result.drafts).toEqual([]);
      // Must NOT call LLM when there is nothing to cluster
      expect(adapter.completeCalls).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });

  test("2 episodes from 2 sessions → 1 draft created, episodes marked as clustered", async () => {
    const { root, episodesDir, quarantineSkillsDir, cfg } = await mkTickFixture();
    try {
      // Two episodes from different sessions
      const ep1 = makeEpisode({ sessionId: "sess-A", id: "ep-tick-aa01" });
      const ep2 = makeEpisode({ sessionId: "sess-B", id: "ep-tick-bb02" });
      await appendEpisodes([ep1, ep2], episodesDir);

      // Adapter: first call = cluster response, second = draft SKILL.md
      const clusterResponse = JSON.stringify({
        groups: [
          {
            name: "restart-syut",
            episodeIds: [ep1.id, ep2.id],
            worthSkill: true,
            reason: "Recurring restart procedure.",
          },
        ],
      });
      const draftMd = makeValidSkillMd("restart-syut");
      const adapter = new MockAdapter({ completions: [clusterResponse, draftMd] });

      const result = await runSkillsTick({ episodesDir, quarantineSkillsDir, cfg, adapter });

      // Should have created exactly 1 draft
      expect(result.drafts).toHaveLength(1);
      expect(result.drafts[0]).toBe("restart-syut");

      // Draft directory and SKILL.md should exist
      const draftDir = path.join(quarantineSkillsDir, "restart-syut");
      await expect(fs.access(path.join(draftDir, "SKILL.md"))).resolves.toBeNull();
      await expect(fs.access(path.join(draftDir, "meta.json"))).resolves.toBeNull();

      // meta.json should contain correct episodeIds and sessions
      const metaRaw = await fs.readFile(path.join(draftDir, "meta.json"), "utf-8");
      const meta = JSON.parse(metaRaw) as Record<string, unknown>;
      expect(meta.name).toBe("restart-syut");
      expect(meta.status).toBe("pending");
      const epIds = meta.episodeIds as string[];
      expect(epIds).toContain(ep1.id);
      expect(epIds).toContain(ep2.id);

      // Episodes should be marked as clustered in the episode store
      const { listUnclustered } = await import("../src/episode-store.ts");
      const remaining = await listUnclustered(episodesDir);
      expect(remaining).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });

  test("second run → 0 drafts and 0 LLM calls (no unclustered episodes left)", async () => {
    const { root, episodesDir, quarantineSkillsDir, cfg } = await mkTickFixture();
    try {
      const ep1 = makeEpisode({ sessionId: "sess-C", id: "ep-tick-cc03" });
      const ep2 = makeEpisode({ sessionId: "sess-D", id: "ep-tick-dd04" });
      await appendEpisodes([ep1, ep2], episodesDir);

      const clusterResponse = JSON.stringify({
        groups: [
          {
            name: "deploy-app",
            episodeIds: [ep1.id, ep2.id],
            worthSkill: true,
            reason: "Deploy procedure.",
          },
        ],
      });
      const draftMd = makeValidSkillMd("deploy-app");

      // First run
      const adapter1 = new MockAdapter({ completions: [clusterResponse, draftMd] });
      const result1 = await runSkillsTick({ episodesDir, quarantineSkillsDir, cfg, adapter: adapter1 });
      expect(result1.drafts).toHaveLength(1);
      expect(adapter1.completeCalls).toBeGreaterThan(0);

      // Second run: episodes already clustered → no LLM calls
      const adapter2 = new MockAdapter({ completions: ['{"groups":[]}'] });
      const result2 = await runSkillsTick({ episodesDir, quarantineSkillsDir, cfg, adapter: adapter2 });
      expect(result2.drafts).toHaveLength(0);
      expect(adapter2.completeCalls).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });

  test("dedup: existing draft with same name skipped (no second draft)", async () => {
    const { root, episodesDir, quarantineSkillsDir, cfg } = await mkTickFixture();
    try {
      const ep1 = makeEpisode({ sessionId: "sess-E", id: "ep-tick-ee05" });
      const ep2 = makeEpisode({ sessionId: "sess-F", id: "ep-tick-ff06" });
      await appendEpisodes([ep1, ep2], episodesDir);

      // Pre-create a draft with the same name
      const { writeSkillDraft } = await import("../src/skill-draft.ts");
      await writeSkillDraft(
        "existing-skill",
        makeValidSkillMd("existing-skill"),
        {
          name: "existing-skill",
          createdAt: new Date().toISOString(),
          episodeIds: [],
          sessions: [],
          model: "mock-v1",
          status: "pending",
        },
        quarantineSkillsDir,
      );

      const clusterResponse = JSON.stringify({
        groups: [
          {
            name: "existing-skill",
            episodeIds: [ep1.id, ep2.id],
            worthSkill: true,
            reason: "Already exists.",
          },
        ],
      });
      const draftMd = makeValidSkillMd("existing-skill");
      const adapter = new MockAdapter({ completions: [clusterResponse, draftMd] });

      const result = await runSkillsTick({ episodesDir, quarantineSkillsDir, cfg, adapter });

      // No new draft created (existing one prevents it)
      expect(result.drafts).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });

  test("dedup: skill already in skillsDir → not drafted again", async () => {
    const { root, episodesDir, quarantineSkillsDir, skillsDir, cfg } = await mkTickFixture();
    try {
      const ep1 = makeEpisode({ sessionId: "sess-G", id: "ep-tick-gg07" });
      const ep2 = makeEpisode({ sessionId: "sess-H", id: "ep-tick-hh08" });
      await appendEpisodes([ep1, ep2], episodesDir);

      // Pre-install the skill in skillsDir
      const installedDir = path.join(skillsDir, "installed-skill");
      await fs.mkdir(installedDir, { recursive: true });
      await fs.writeFile(
        path.join(installedDir, "SKILL.md"),
        makeValidSkillMd("installed-skill"),
        "utf-8",
      );

      const clusterResponse = JSON.stringify({
        groups: [
          {
            name: "installed-skill",
            episodeIds: [ep1.id, ep2.id],
            worthSkill: true,
            reason: "Already installed.",
          },
        ],
      });
      const draftMd = makeValidSkillMd("installed-skill");
      const adapter = new MockAdapter({ completions: [clusterResponse, draftMd] });

      const result = await runSkillsTick({ episodesDir, quarantineSkillsDir, cfg, adapter });

      // No new draft since skill is already installed
      expect(result.drafts).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });

  test("notifyCommand error does not abort tick", async () => {
    const { root, episodesDir, quarantineSkillsDir, skillsDir } = await mkTickFixture();
    try {
      const ep1 = makeEpisode({ sessionId: "sess-I", id: "ep-tick-ii09" });
      const ep2 = makeEpisode({ sessionId: "sess-J", id: "ep-tick-jj10" });
      await appendEpisodes([ep1, ep2], episodesDir);

      // Use an invalid command that will definitely fail
      const cfg: SkillDetectorConfig = {
        skillsDir,
        notifyCommand: "false",  // `false` is a shell command that always exits 1
        minToolOps: 5,
        minSessions: 2,
      };

      const clusterResponse = JSON.stringify({
        groups: [
          {
            name: "notify-test",
            episodeIds: [ep1.id, ep2.id],
            worthSkill: true,
            reason: "Notify test.",
          },
        ],
      });
      const draftMd = makeValidSkillMd("notify-test");
      const adapter = new MockAdapter({ completions: [clusterResponse, draftMd] });

      // Should NOT throw even though notify command fails
      const result = await runSkillsTick({ episodesDir, quarantineSkillsDir, cfg, adapter });
      expect(result.drafts).toHaveLength(1);
      expect(result.drafts[0]).toBe("notify-test");
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });
});
