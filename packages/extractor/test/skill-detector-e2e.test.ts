/**
 * skill-detector-e2e.test.ts — End-to-end test for the skill-detector pipeline.
 *
 * Two mock sessions with the same routine → runEpisodeStage ×2 → runSkillsTick
 * → draft in quarantine with valid SKILL.md → promoteSkillDraft → skill installed.
 * All paths are tmp dirs; nothing touches the real filesystem.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MockAdapter } from "../src/adapters/mock.ts";
import { makeEpisodeId } from "../src/episode-store.ts";
import { runEpisodeStage } from "../src/session-end.ts";
import { loadSkillConfig } from "../src/skill-config.ts";
import { promoteSkillDraft } from "../src/skill-quarantine.ts";
import { runSkillsTick } from "../src/skills-tick.ts";

// ---------------------------------------------------------------------------
// Transcript fixture
// ---------------------------------------------------------------------------

const FIXTURE_TIMESTAMP = "2026-06-10T10:00:00.000Z";
const FIXTURE_DATE = "2026-06-10";
const FIXTURE_GOAL = "перезапуск сервиса syut";

/**
 * Build a minimal JSONL transcript with tool_use/tool_result pairs.
 * Includes a timestamp so sessionDateFromTranscript returns FIXTURE_DATE.
 * Has 6 tool operations which meets the default minToolOps=5 threshold.
 */
function makeTranscript(sessionId: string): string {
  const ts = FIXTURE_TIMESTAMP;
  const events: object[] = [
    {
      type: "user",
      sessionId,
      timestamp: ts,
      message: { role: "user", content: "перезапусти syut" },
    },
  ];

  // 6 tool_use/tool_result pairs → 6 toolOps, exceeds minToolOps=5
  for (let i = 0; i < 6; i++) {
    const toolId = `t${i}`;
    events.push({
      type: "assistant",
      sessionId,
      timestamp: ts,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: toolId,
            name: "Bash",
            input: { command: `systemctl status syut-${i}` },
          },
        ],
      },
    });
    events.push({
      type: "user",
      sessionId,
      timestamp: ts,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolId, content: "ok" }],
      },
    });
  }

  return events.map((e) => JSON.stringify(e)).join("\n");
}

/** Build a mock completion response for episode extraction. */
function makeEpisodeCompletion(toolOps = 7): string {
  return JSON.stringify({
    episodes: [
      {
        goal: FIXTURE_GOAL,
        steps: [
          "проверить статус сервиса",
          "перезапустить юнит через systemctl",
          "проверить логи сервиса",
        ],
        toolOps,
        errorRecovery: false,
        project: "syut",
        tags: ["deploy", "systemd"],
      },
    ],
  });
}

/** Build a minimal valid SKILL.md that passes isValidSkillMd(). */
function makeValidSkillMd(name: string): string {
  return `---
name: ${name}
description: Use this skill when restarting ${name} service.
---

# ${name}

## When to use

Когда нужно перезапустить сервис ${name} на сервере.

## Procedure

1. Проверить статус сервиса командой \`systemctl status ${name}\`.
2. Перезапустить юнит через \`systemctl restart ${name}\`.
3. Проверить логи через \`journalctl -u ${name} -n 50\`.

## Pitfalls

Не запускать дважды без остановки — сервис может зависнуть при двойном рестарте.

## Verification

Убедиться, что \`systemctl is-active ${name}\` возвращает \`active\`.
`;
}

// ---------------------------------------------------------------------------
// Fixture directory structure
// ---------------------------------------------------------------------------

interface E2EFixture {
  root: string;
  episodesDir: string;
  quarantineSkillsDir: string;
  skillsDir: string;
}

async function mkE2EFixture(): Promise<E2EFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-e2e-test-"));
  const episodesDir = path.join(root, "episodes");
  const quarantineSkillsDir = path.join(root, "quarantine", "skills");
  const skillsDir = path.join(root, "skills");

  await fs.mkdir(episodesDir, { recursive: true });
  await fs.mkdir(quarantineSkillsDir, { recursive: true });
  await fs.mkdir(skillsDir, { recursive: true });
  // quarantine parent dir needed for promoted.jsonl
  await fs.mkdir(path.join(root, "quarantine"), { recursive: true });

  return { root, episodesDir, quarantineSkillsDir, skillsDir };
}

// ---------------------------------------------------------------------------
// E2E test
// ---------------------------------------------------------------------------

describe("skill-detector E2E", () => {
  let fixture: E2EFixture;

  beforeEach(async () => {
    fixture = await mkE2EFixture();
  });

  afterEach(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  test("two sessions with same routine → draft created → skill promoted", async () => {
    const { root, episodesDir, quarantineSkillsDir, skillsDir } = fixture;

    // --- Stage A: extract episodes from two sessions -------------------------

    const sessionId1 = "session-e2e-01";
    const sessionId2 = "session-e2e-02";
    const transcript1 = makeTranscript(sessionId1);
    const transcript2 = makeTranscript(sessionId2);

    // Both sessions share the same goal, so clusterEpisodes will group them
    const adapter1 = new MockAdapter({ completions: [makeEpisodeCompletion()] });
    const adapter2 = new MockAdapter({ completions: [makeEpisodeCompletion()] });

    const written1 = await runEpisodeStage(transcript1, sessionId1, adapter1, {
      minToolOps: 5,
      episodesDir,
    });
    const written2 = await runEpisodeStage(transcript2, sessionId2, adapter2, {
      minToolOps: 5,
      episodesDir,
    });

    // Verify: two episodes written to the monthly file
    expect(written1).toBe(1);
    expect(written2).toBe(1);

    const monthFile = path.join(episodesDir, `${FIXTURE_DATE.slice(0, 7)}.jsonl`);
    const monthFileContent = await fs.readFile(monthFile, "utf-8");
    const lines = monthFileContent.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(2);

    const ep1Parsed = JSON.parse(lines[0] as string) as {
      id: string;
      sessionId: string;
      date: string;
      goal: string;
    };
    const ep2Parsed = JSON.parse(lines[1] as string) as {
      id: string;
      sessionId: string;
      date: string;
      goal: string;
    };

    // Verify: correct sessionIds and dates
    expect(ep1Parsed.sessionId).toBe(sessionId1);
    expect(ep2Parsed.sessionId).toBe(sessionId2);
    expect(ep1Parsed.date).toBe(FIXTURE_DATE);
    expect(ep2Parsed.date).toBe(FIXTURE_DATE);

    // Verify: IDs match makeEpisodeId
    expect(ep1Parsed.id).toBe(makeEpisodeId(sessionId1, FIXTURE_GOAL));
    expect(ep2Parsed.id).toBe(makeEpisodeId(sessionId2, FIXTURE_GOAL));

    // --- Stage B: cluster episodes and generate draft -------------------------

    const ep1Id = ep1Parsed.id;
    const ep2Id = ep2Parsed.id;
    const skillName = "restart-syut";

    const clusterResponse = JSON.stringify({
      groups: [
        {
          name: skillName,
          episodeIds: [ep1Id, ep2Id],
          worthSkill: true,
          reason: "Recurring service restart procedure across multiple sessions.",
        },
      ],
    });

    const draftMd = makeValidSkillMd(skillName);

    const tickAdapter = new MockAdapter({
      completions: [clusterResponse, draftMd],
    });

    const cfg = loadSkillConfig({
      LITOPYS_SKILLS_DIR: skillsDir,
      LITOPYS_SKILLS_MIN_SESSIONS: "2",
      LITOPYS_SKILLS_MIN_TOOL_OPS: "5",
    });

    const tickResult = await runSkillsTick({
      episodesDir,
      quarantineSkillsDir,
      cfg,
      adapter: tickAdapter,
    });

    // Verify: one draft created with the correct name
    expect(tickResult.drafts).toHaveLength(1);
    expect(tickResult.drafts[0]).toBe(skillName);

    // Verify: draft directory exists on disk
    const draftDir = path.join(quarantineSkillsDir, skillName);
    const draftDirStat = await fs.stat(draftDir);
    expect(draftDirStat.isDirectory()).toBe(true);

    // Verify: SKILL.md exists and has frontmatter + 4 required sections
    const skillMdPath = path.join(draftDir, "SKILL.md");
    const skillMdContent = await fs.readFile(skillMdPath, "utf-8");
    expect(skillMdContent.trimStart().startsWith("---")).toBe(true);
    expect(skillMdContent).toContain("name:");
    expect(skillMdContent).toContain("## When to use");
    expect(skillMdContent).toContain("## Procedure");
    expect(skillMdContent).toContain("## Pitfalls");
    expect(skillMdContent).toContain("## Verification");

    // Verify: meta.json has correct episodeIds and sessions
    const metaPath = path.join(draftDir, "meta.json");
    const metaContent = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(metaContent) as {
      name: string;
      episodeIds: string[];
      sessions: string[];
      status: string;
    };
    expect(meta.name).toBe(skillName);
    expect(meta.status).toBe("pending");
    expect(meta.episodeIds).toContain(ep1Id);
    expect(meta.episodeIds).toContain(ep2Id);
    expect(meta.sessions).toContain(sessionId1);
    expect(meta.sessions).toContain(sessionId2);

    // --- Promote: move draft to installed skills dir --------------------------

    const installedPath = await promoteSkillDraft(skillName, quarantineSkillsDir, skillsDir);

    // Verify: skill installed to the correct path
    expect(installedPath).toBe(path.join(skillsDir, skillName));

    // Verify: SKILL.md present in skillsDir.
    // stripCodeFences in draftSkill trims the mock response, so compare trimmed.
    const installedMd = await fs.readFile(path.join(skillsDir, skillName, "SKILL.md"), "utf-8");
    expect(installedMd).toBe(draftMd.trim());

    // Verify: meta.json NOT in skillsDir (promote strips it)
    const metaInSkillsDir = await fs
      .access(path.join(skillsDir, skillName, "meta.json"))
      .then(() => true)
      .catch(() => false);
    expect(metaInSkillsDir).toBe(false);

    // Verify: draft directory removed from quarantine
    const draftStillExists = await fs
      .access(draftDir)
      .then(() => true)
      .catch(() => false);
    expect(draftStillExists).toBe(false);

    // Verify: promoted.jsonl written with correct fields
    const promotedLog = path.join(quarantineSkillsDir, "..", "promoted.jsonl");
    const promotedContent = await fs.readFile(promotedLog, "utf-8");
    const promotedEntry = JSON.parse(promotedContent.trim()) as {
      name: string;
      installedTo: string;
    };
    expect(promotedEntry.name).toBe(skillName);
    expect(promotedEntry.installedTo).toBe(path.join(skillsDir, skillName));

    // Verify: no unclustered episodes remain (markClustered ran)
    const { listUnclustered } = await import("../src/episode-store.ts");
    const remaining = await listUnclustered(episodesDir);
    expect(remaining).toHaveLength(0);
  });
});
