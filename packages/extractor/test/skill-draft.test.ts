/**
 * skill-draft.test.ts — Tests for Stage B: clusterEpisodes, selectDraftable,
 * normalizeSkillName, draftSkill, writeSkillDraft
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MockAdapter } from "../src/adapters/mock.ts";
import type { Episode } from "../src/episode-store.ts";
import type { SkillDetectorConfig } from "../src/skill-config.ts";
import {
  clusterEpisodes,
  draftSkill,
  normalizeSkillName,
  selectDraftable,
  writeSkillDraft,
} from "../src/skill-draft.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _epCounter = 0;

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  const n = ++_epCounter;
  return {
    id: `ep-test-${String(n).padStart(4, "0")}`,
    sessionId: `session-${n}`,
    date: "2026-06-10",
    goal: `Test goal ${n}`,
    steps: ["step 1", "step 2", "step 3"],
    toolOps: 5,
    errorRecovery: false,
    project: null,
    tags: ["test"],
    clusteredInto: null,
    ...overrides,
  };
}

const DEFAULT_CFG: SkillDetectorConfig = {
  skillsDir: "/tmp/skills",
  notifyCommand: null,
  minToolOps: 5,
  minSessions: 2,
  lang: "English",
};

// Minimal valid SKILL.md template
function makeValidSkillMd(name: string): string {
  return `---
name: ${name}
description: Use this when you need to perform ${name} operations.
---

# ${name}

## When to use

When you need to do this thing.

## Procedure

1. Первый шаг — выполнить команду.
2. Второй шаг — проверить результат.

## Pitfalls

Не делать это слишком быстро.

## Verification

Проверить что всё работает.
`;
}

// ---------------------------------------------------------------------------
// clusterEpisodes
// ---------------------------------------------------------------------------

describe("clusterEpisodes", () => {
  test("happy path — returns 1 group from LLM response", async () => {
    const ep1 = makeEpisode({ id: "ep-aaa111000001", sessionId: "sess-A" });
    const ep2 = makeEpisode({ id: "ep-bbb222000002", sessionId: "sess-B" });

    const groupsJson = JSON.stringify({
      groups: [
        {
          name: "restart-service",
          episodeIds: [ep1.id, ep2.id],
          worthSkill: true,
          reason: "Recurring service restart pattern.",
        },
      ],
    });

    const adapter = new MockAdapter({ completions: [groupsJson] });
    const groups = await clusterEpisodes([ep1, ep2], adapter);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("restart-service");
    expect(groups[0]?.episodeIds).toEqual([ep1.id, ep2.id]);
    expect(groups[0]?.worthSkill).toBe(true);
    expect(adapter.completeCalls).toBe(1);
  });

  test("empty input → returns [] without any LLM call", async () => {
    const adapter = new MockAdapter({
      completions: ['{"groups":[{"name":"x","episodeIds":[],"worthSkill":true,"reason":"r"}]}'],
    });
    const groups = await clusterEpisodes([], adapter);

    expect(groups).toEqual([]);
    expect(adapter.completeCalls).toBe(0);
  });

  test("unparseable response → retries once → completeCalls === 2 → returns []", async () => {
    const adapter = new MockAdapter({ completions: ["not json at all"] });
    const ep = makeEpisode();
    const groups = await clusterEpisodes([ep], adapter);

    expect(groups).toEqual([]);
    expect(adapter.completeCalls).toBe(2);
  });

  test("fenced response → fences stripped → parses correctly", async () => {
    const ep = makeEpisode({ id: "ep-fenced000001" });
    const inner = JSON.stringify({
      groups: [
        {
          name: "fenced-skill",
          episodeIds: [ep.id],
          worthSkill: true,
          reason: "Test fences.",
        },
      ],
    });
    const fenced = `\`\`\`json\n${inner}\n\`\`\``;

    const adapter = new MockAdapter({ completions: [fenced] });
    const groups = await clusterEpisodes([ep], adapter);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("fenced-skill");
  });

  test("hallucinated episodeId filtered from group — valid ids remain", async () => {
    const ep = makeEpisode({ id: "ep-real000001" });

    const groupsJson = JSON.stringify({
      groups: [
        {
          name: "hallucination-test",
          episodeIds: [ep.id, "ep-does-not-exist"],
          worthSkill: true,
          reason: "Has a hallucinated id.",
        },
      ],
    });

    const adapter = new MockAdapter({ completions: [groupsJson] });
    const groups = await clusterEpisodes([ep], adapter);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.episodeIds).toEqual([ep.id]);
  });

  test("broken group skipped, valid group survives", async () => {
    const ep = makeEpisode({ id: "ep-good000001" });

    // First group is missing required `reason` field (invalid by schema)
    const groupsJson = JSON.stringify({
      groups: [
        {
          name: "broken-group",
          episodeIds: [ep.id],
          worthSkill: true,
          // missing reason
        },
        {
          name: "valid-group",
          episodeIds: [ep.id],
          worthSkill: false,
          reason: "This one is fine.",
        },
      ],
    });

    const adapter = new MockAdapter({ completions: [groupsJson] });
    const groups = await clusterEpisodes([ep], adapter);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("valid-group");
  });

  test("bad first response, good second → parsed result, completeCalls === 2", async () => {
    const ep = makeEpisode({ id: "ep-recover00001" });
    const goodJson = JSON.stringify({
      groups: [
        {
          name: "recovered-group",
          episodeIds: [ep.id],
          worthSkill: true,
          reason: "Recovered after retry.",
        },
      ],
    });

    const adapter = new MockAdapter({ completions: ["garbage, not json", goodJson] });
    const groups = await clusterEpisodes([ep], adapter);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("recovered-group");
    expect(adapter.completeCalls).toBe(2);
  });

  test("group with all hallucinated ids → group becomes empty → discarded", async () => {
    const ep = makeEpisode({ id: "ep-real000002" });

    const groupsJson = JSON.stringify({
      groups: [
        {
          name: "all-hallucinated",
          episodeIds: ["ep-ghost-1", "ep-ghost-2"],
          worthSkill: true,
          reason: "All ids are fake.",
        },
      ],
    });

    const adapter = new MockAdapter({ completions: [groupsJson] });
    const groups = await clusterEpisodes([ep], adapter);

    // Empty group after filtering hallucinated ids → discarded
    expect(groups).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectDraftable
// ---------------------------------------------------------------------------

describe("selectDraftable", () => {
  test("group spanning 2 different sessions → draftable", () => {
    const ep1 = makeEpisode({ sessionId: "sess-A", toolOps: 5 });
    const ep2 = makeEpisode({ sessionId: "sess-B", toolOps: 5 });

    const group = {
      name: "multi-session",
      episodeIds: [ep1.id, ep2.id],
      worthSkill: true,
      reason: "Two sessions.",
    };

    const result = selectDraftable([group], [ep1, ep2], DEFAULT_CFG);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("multi-session");
  });

  test("2 episodes in same session → not draftable (no errorRecovery override)", () => {
    const ep1 = makeEpisode({ sessionId: "sess-X", toolOps: 5, errorRecovery: false });
    const ep2 = makeEpisode({ sessionId: "sess-X", toolOps: 5, errorRecovery: false });

    const group = {
      name: "single-session",
      episodeIds: [ep1.id, ep2.id],
      worthSkill: true,
      reason: "Same session.",
    };

    const result = selectDraftable([group], [ep1, ep2], DEFAULT_CFG);
    expect(result).toHaveLength(0);
  });

  test("single episode with errorRecovery + toolOps>=5 → draftable", () => {
    const ep = makeEpisode({ sessionId: "sess-A", toolOps: 7, errorRecovery: true });

    const group = {
      name: "single-recovery",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Single with errorRecovery.",
    };

    const result = selectDraftable([group], [ep], DEFAULT_CFG);
    expect(result).toHaveLength(1);
  });

  test("single episode without errorRecovery → not draftable", () => {
    const ep = makeEpisode({ sessionId: "sess-A", toolOps: 7, errorRecovery: false });

    const group = {
      name: "single-no-recovery",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Single without errorRecovery.",
    };

    const result = selectDraftable([group], [ep], DEFAULT_CFG);
    expect(result).toHaveLength(0);
  });

  test("worthSkill false → not draftable even with 2 sessions", () => {
    const ep1 = makeEpisode({ sessionId: "sess-A", toolOps: 5 });
    const ep2 = makeEpisode({ sessionId: "sess-B", toolOps: 5 });

    const group = {
      name: "not-worth",
      episodeIds: [ep1.id, ep2.id],
      worthSkill: false,
      reason: "Not worth it.",
    };

    const result = selectDraftable([group], [ep1, ep2], DEFAULT_CFG);
    expect(result).toHaveLength(0);
  });

  test("group with 0 episodeIds after filtering → discarded", () => {
    const group = {
      name: "empty-group",
      episodeIds: [],
      worthSkill: true,
      reason: "All ids removed.",
    };

    const result = selectDraftable([group], [], DEFAULT_CFG);
    expect(result).toHaveLength(0);
  });

  test("single episode with errorRecovery but toolOps < minToolOps → not draftable", () => {
    const ep = makeEpisode({ sessionId: "sess-A", toolOps: 2, errorRecovery: true });

    const group = {
      name: "low-toolops",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Too few toolOps.",
    };

    const result = selectDraftable([group], [ep], DEFAULT_CFG);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeSkillName
// ---------------------------------------------------------------------------

describe("normalizeSkillName", () => {
  test('"Restart SYUT!" → "restart-syut"', () => {
    expect(normalizeSkillName("Restart SYUT!", [])).toBe("restart-syut");
  });

  test("collision with existing → appends -2", () => {
    expect(normalizeSkillName("Restart SYUT!", ["restart-syut"])).toBe("restart-syut-2");
  });

  test("collision with -2 → appends -3", () => {
    expect(normalizeSkillName("Restart SYUT!", ["restart-syut", "restart-syut-2"])).toBe(
      "restart-syut-3",
    );
  });

  test("empty string after normalization → default base 'skill'", () => {
    expect(normalizeSkillName("!!!", [])).toBe("skill");
  });

  test("empty normalized with existing 'skill' → 'skill-2'", () => {
    expect(normalizeSkillName("!!!", ["skill"])).toBe("skill-2");
  });

  test("already lowercase kebab-case → unchanged", () => {
    expect(normalizeSkillName("deploy-app", [])).toBe("deploy-app");
  });

  test("multiple spaces/special chars → collapsed to single dash", () => {
    expect(normalizeSkillName("deploy   app!!!", [])).toBe("deploy-app");
  });

  test("leading/trailing dashes removed", () => {
    expect(normalizeSkillName("---deploy-app---", [])).toBe("deploy-app");
  });

  test("name longer than 64 chars → truncated to 64", () => {
    const long = "a".repeat(70);
    const result = normalizeSkillName(long, []);
    expect(result.length).toBeLessThanOrEqual(64);
  });
});

// ---------------------------------------------------------------------------
// draftSkill
// ---------------------------------------------------------------------------

describe("draftSkill", () => {
  test("valid markdown response → returned as-is", async () => {
    const ep = makeEpisode({ id: "ep-draft000001", sessionId: "sess-A" });
    const group = {
      name: "test-skill",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    const validMd = makeValidSkillMd("test-skill");
    const adapter = new MockAdapter({ completions: [validMd] });

    const result = await draftSkill(group, [ep], adapter);
    expect(result).toStartWith("---");
    expect(result).toContain("name:");
    expect(result).toContain("## When to use");
    expect(result).toContain("## Procedure");
    expect(result).toContain("## Pitfalls");
    expect(result).toContain("## Verification");
  });

  test("localized section headers (Qwen-style) → normalized to English → accepted on first try", async () => {
    const ep = makeEpisode({ id: "ep-localized0001", sessionId: "sess-A" });
    const group = {
      name: "localized-skill",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    // Model translated two of the four headers into Russian (observed with
    // Qwen3-Next). Exactly 4 level-2 headers, all bodies non-empty.
    const localized = `---
name: localized-skill
description: Use this when a systemd service has failed.
---

# Перезапуск сервиса

## Когда использовать

Когда сервис упал.

## Процедура

1. Посмотреть логи.
2. Перезапустить.

## Pitfalls

Не менять конфиг.

## Verification

Проверить статус.
`;
    const adapter = new MockAdapter({ completions: [localized] });

    const result = await draftSkill(group, [ep], adapter);
    expect(adapter.completeCalls).toBe(1);
    expect(result).toContain("## When to use");
    expect(result).toContain("## Procedure");
    expect(result).toContain("## Pitfalls");
    expect(result).toContain("## Verification");
    expect(result).not.toContain("## Когда использовать");
    expect(result).not.toContain("## Процедура");
    // model's body content is preserved
    expect(result).toContain("Посмотреть логи.");
  });

  test("more than 4 level-2 headers → normalization skipped (guard) → localized headers rejected → retry", async () => {
    const ep = makeEpisode({ id: "ep-localized0002", sessionId: "sess-A" });
    const group = {
      name: "extra-header-skill",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    // 5 level-2 headers (an extra `## ` inside the body) with localized ones →
    // positional remap must NOT fire → English headers stay missing → invalid.
    const extra = `---
name: extra-header-skill
description: Use this when something.
---

# Title

## Когда использовать

Когда нужно.

## Процедура

1. Шаг.

## Детали

Подробности.

## Pitfalls

Осторожно.

## Verification

Проверить.
`;
    const adapter = new MockAdapter({ completions: [extra] });

    await expect(draftSkill(group, [ep], adapter)).rejects.toThrow();
    expect(adapter.completeCalls).toBe(2);
  });

  test("section body opening with a ### sub-header is valid (not a false empty body)", async () => {
    const ep = makeEpisode({ id: "ep-subhdr00001", sessionId: "sess-A" });
    const group = {
      name: "install-and-troubleshoot",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    // Realistic Qwen output for an "installation AND troubleshooting" cluster:
    // the Procedure groups steps under ### sub-headers. Exactly 4 level-2
    // headers, every section non-empty — a ### line is body content, NOT a
    // section boundary, so the draft MUST be accepted on the first try.
    const withSubheaders = `---
name: install-and-troubleshoot
description: Use this when installing and troubleshooting a systemd user service.
---

# Установка и диагностика

## When to use

Когда нужно поставить и починить пользовательский сервис systemd.

## Procedure

### Installation
1. Создать unit-файл в ~/.config/systemd/user/.
2. systemctl --user daemon-reload.

### Troubleshooting
1. Проверить XDG_RUNTIME_DIR.

## Pitfalls

Без XDG_RUNTIME_DIR команды systemctl --user падают.

## Verification

systemctl --user status показывает active.
`;
    const adapter = new MockAdapter({ completions: [withSubheaders] });

    const result = await draftSkill(group, [ep], adapter);
    expect(adapter.completeCalls).toBe(1);
    expect(result).toContain("### Installation");
    expect(result).toContain("### Troubleshooting");
    expect(result).toContain("## Procedure");
  });

  test("response wrapped in code fences → fences stripped", async () => {
    const ep = makeEpisode({ id: "ep-draft000002", sessionId: "sess-A" });
    const group = {
      name: "fenced-draft",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    const validMd = makeValidSkillMd("fenced-draft");
    const fenced = `\`\`\`markdown\n${validMd}\n\`\`\``;
    const adapter = new MockAdapter({ completions: [fenced] });

    const result = await draftSkill(group, [ep], adapter);
    expect(result).toStartWith("---");
    expect(result).not.toContain("```");
  });

  test("response missing sections → retries once → throws on second bad response", async () => {
    const ep = makeEpisode({ id: "ep-draft000003", sessionId: "sess-A" });
    const group = {
      name: "bad-skill",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    // Both responses are garbage (no sections, not starting with ---)
    const garbage = "This is not a valid SKILL.md at all.";
    const adapter = new MockAdapter({ completions: [garbage] });

    await expect(draftSkill(group, [ep], adapter)).rejects.toThrow();
    expect(adapter.completeCalls).toBe(2);
  });

  test("template echo (4 headers, empty bodies) → retry → throws", async () => {
    const ep = makeEpisode({ id: "ep-skeleton0001", sessionId: "sess-A" });
    const group = {
      name: "skeleton-skill",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    // Echoes the template: frontmatter + all 4 headers, but every body empty.
    const skeleton = `---
name: skeleton-skill
description: Some description.
---

# Skeleton

## When to use

## Procedure

## Pitfalls

## Verification
`;
    const adapter = new MockAdapter({ completions: [skeleton] });

    await expect(draftSkill(group, [ep], adapter)).rejects.toThrow();
    expect(adapter.completeCalls).toBe(2);
  });

  test("one empty section among filled ones → rejected (retry → throw)", async () => {
    const ep = makeEpisode({ id: "ep-skeleton0002", sessionId: "sess-A" });
    const group = {
      name: "half-skill",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    const halfFilled = `---
name: half-skill
description: Some description.
---

# Half

## When to use

Когда нужно сделать дело.

## Procedure

1. Сделать шаг.

## Pitfalls

## Verification

Проверить результат.
`;
    const adapter = new MockAdapter({ completions: [halfFilled] });

    await expect(draftSkill(group, [ep], adapter)).rejects.toThrow();
    expect(adapter.completeCalls).toBe(2);
  });

  test("first response invalid, second valid → returns valid result", async () => {
    const ep = makeEpisode({ id: "ep-draft000004", sessionId: "sess-A" });
    const group = {
      name: "retry-skill",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    const garbage = "Not a valid SKILL.md";
    const validMd = makeValidSkillMd("retry-skill");
    const adapter = new MockAdapter({ completions: [garbage, validMd] });

    const result = await draftSkill(group, [ep], adapter);
    expect(result).toStartWith("---");
    expect(adapter.completeCalls).toBe(2);
  });

  test("default lang is English — prompt contains 'in English'", async () => {
    const ep = makeEpisode({ id: "ep-lang-default01", sessionId: "sess-A" });
    const group = {
      name: "lang-default",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    const validMd = makeValidSkillMd("lang-default");
    const capturedPrompts: string[] = [];
    const inner = new MockAdapter({ completions: [validMd] });
    const adapter = {
      name: inner.name,
      model: inner.model,
      extract: (input: Parameters<typeof inner.extract>[0]) => inner.extract(input),
      complete: (input: Parameters<typeof inner.complete>[0]) => {
        capturedPrompts.push(input.prompt);
        return inner.complete(input);
      },
    };

    await draftSkill(group, [ep], adapter);

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("in English");
    expect(capturedPrompts[0]).not.toContain("{lang}");
  });

  test("custom lang is substituted into prompt", async () => {
    const ep = makeEpisode({ id: "ep-lang-custom001", sessionId: "sess-A" });
    const group = {
      name: "lang-custom",
      episodeIds: [ep.id],
      worthSkill: true,
      reason: "Test.",
    };

    const validMd = makeValidSkillMd("lang-custom");
    const capturedPrompts: string[] = [];
    const inner = new MockAdapter({ completions: [validMd] });
    const adapter = {
      name: inner.name,
      model: inner.model,
      extract: (input: Parameters<typeof inner.extract>[0]) => inner.extract(input),
      complete: (input: Parameters<typeof inner.complete>[0]) => {
        capturedPrompts.push(input.prompt);
        return inner.complete(input);
      },
    };

    await draftSkill(group, [ep], adapter, "Ukrainian");

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("in Ukrainian");
    expect(capturedPrompts[0]).not.toContain("{lang}");
  });
});

// ---------------------------------------------------------------------------
// writeSkillDraft
// ---------------------------------------------------------------------------

describe("writeSkillDraft", () => {
  test("creates SKILL.md and meta.json in <dir>/<name>/", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-skill-test-"));
    try {
      const name = "test-draft-skill";
      const skillMd = makeValidSkillMd(name);
      const meta = {
        name,
        createdAt: "2026-06-10T12:00:00.000Z",
        episodeIds: ["ep-111", "ep-222"],
        sessions: ["sess-A", "sess-B"],
        model: "mock-v1",
        status: "pending" as const,
      };

      const draftDir = await writeSkillDraft(name, skillMd, meta, tmpDir);

      expect(draftDir).toBe(path.join(tmpDir, name));

      const skillMdContent = await fs.readFile(path.join(draftDir, "SKILL.md"), "utf-8");
      expect(skillMdContent).toBe(skillMd);

      const metaContent = await fs.readFile(path.join(draftDir, "meta.json"), "utf-8");
      const parsedMeta = JSON.parse(metaContent);
      expect(parsedMeta.name).toBe(name);
      expect(parsedMeta.status).toBe("pending");
      expect(parsedMeta.episodeIds).toEqual(["ep-111", "ep-222"]);
      expect(parsedMeta.sessions).toEqual(["sess-A", "sess-B"]);
      expect(parsedMeta.model).toBe("mock-v1");
      expect(parsedMeta.createdAt).toBe("2026-06-10T12:00:00.000Z");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("calling again with same name → throws 'draft already exists'", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-skill-test-"));
    try {
      const name = "duplicate-skill";
      const skillMd = makeValidSkillMd(name);
      const meta = {
        name,
        createdAt: "2026-06-10T12:00:00.000Z",
        episodeIds: ["ep-333"],
        sessions: ["sess-C"],
        model: "mock-v1",
        status: "pending" as const,
      };

      await writeSkillDraft(name, skillMd, meta, tmpDir);
      await expect(writeSkillDraft(name, skillMd, meta, tmpDir)).rejects.toThrow(
        `draft already exists: ${name}`,
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("returns absolute path to draft folder", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-skill-test-"));
    try {
      const name = "path-check-skill";
      const skillMd = makeValidSkillMd(name);
      const meta = {
        name,
        createdAt: "2026-06-10T12:00:00.000Z",
        episodeIds: [],
        sessions: [],
        model: "mock-v1",
        status: "pending" as const,
      };

      const result = await writeSkillDraft(name, skillMd, meta, tmpDir);
      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toEndWith(name);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});
