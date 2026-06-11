/**
 * digest-skills.test.ts — Task 12: Skill Drafts Pending section in weekly digest.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Mock adapters BEFORE any imports that load them
// ---------------------------------------------------------------------------

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({ candidateNodes: [], candidateRelations: [] }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      })),
    };
  },
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mock(async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ candidateNodes: [], candidateRelations: [] }),
              },
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        })),
      },
    };
  },
}));

process.env.ANTHROPIC_API_KEY = "sk-mock-test-key";

// Import AFTER mocking
const { generateDigest } = await import("../src/digest.ts");
const { writeSkillDraft } = await import("../src/skill-draft.ts");
import type { SkillDraftMeta } from "../src/skill-draft.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkillMd(
  name: string,
  description = "Triggers when you need to do something.",
): string {
  return `---
name: ${name}
description: ${description}
---

# ${name}

## When to use

Когда необходимо выполнить эту операцию.

## Procedure

1. Открыть терминал.
2. Выполнить команду.

## Pitfalls

Не запускать дважды.

## Verification

Убедиться, что процесс завершился успешно.
`;
}

function makeMeta(name: string, overrides: Partial<SkillDraftMeta> = {}): SkillDraftMeta {
  return {
    name,
    createdAt: "2026-06-10T10:00:00.000Z",
    episodeIds: ["ep-001", "ep-002"],
    sessions: ["sess-001"],
    model: "claude-test",
    status: "pending",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateDigest — Skill Drafts Pending section", () => {
  let tmpDir: string;
  let graphDir: string;
  let skillsQDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-digest-skills-test-"));
    graphDir = path.join(tmpDir, "graph");
    skillsQDir = path.join(tmpDir, "quarantine", "skills");
    await fs.mkdir(graphDir, { recursive: true });
    await fs.mkdir(skillsQDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("digest contains Skill Drafts Pending section header", async () => {
    const result = await generateDigest({ graphPath: graphDir, skillDraftsDir: skillsQDir });
    expect(result.content).toContain("## Skill Drafts Pending");
  });

  test("digest shows 'No skill drafts pending.' when no drafts exist", async () => {
    const result = await generateDigest({ graphPath: graphDir, skillDraftsDir: skillsQDir });
    expect(result.content).toContain("No skill drafts pending.");
  });

  test("digest contains draft name when one draft exists", async () => {
    const name = "deploy-service";
    await writeSkillDraft(name, makeSkillMd(name), makeMeta(name), skillsQDir);

    const result = await generateDigest({ graphPath: graphDir, skillDraftsDir: skillsQDir });
    expect(result.content).toContain("deploy-service");
  });

  test("digest contains litopys skills show command for draft", async () => {
    const name = "run-migration";
    await writeSkillDraft(name, makeSkillMd(name), makeMeta(name), skillsQDir);

    const result = await generateDigest({ graphPath: graphDir, skillDraftsDir: skillsQDir });
    expect(result.content).toContain(`litopys skills show ${name}`);
  });

  test("digest contains draft description", async () => {
    const name = "restart-nginx";
    const description = "Triggers when you need to restart nginx safely.";
    await writeSkillDraft(name, makeSkillMd(name, description), makeMeta(name), skillsQDir);

    const result = await generateDigest({ graphPath: graphDir, skillDraftsDir: skillsQDir });
    expect(result.content).toContain(description);
  });

  test("digest shows episode count for a draft", async () => {
    const name = "backup-db";
    await writeSkillDraft(
      name,
      makeSkillMd(name),
      makeMeta(name, { episodeIds: ["ep-1", "ep-2", "ep-3"] }),
      skillsQDir,
    );

    const result = await generateDigest({ graphPath: graphDir, skillDraftsDir: skillsQDir });
    expect(result.content).toContain("Episodes: 3");
  });

  test("digest lists multiple drafts", async () => {
    await writeSkillDraft(
      "skill-alpha",
      makeSkillMd("skill-alpha"),
      makeMeta("skill-alpha"),
      skillsQDir,
    );
    await writeSkillDraft(
      "skill-beta",
      makeSkillMd("skill-beta"),
      makeMeta("skill-beta"),
      skillsQDir,
    );

    const result = await generateDigest({ graphPath: graphDir, skillDraftsDir: skillsQDir });
    expect(result.content).toContain("skill-alpha");
    expect(result.content).toContain("skill-beta");
  });

  test("digest works when skillDraftsDir is missing (returns no pending)", async () => {
    const missingDir = path.join(tmpDir, "nonexistent", "skills");
    const result = await generateDigest({ graphPath: graphDir, skillDraftsDir: missingDir });
    expect(result.content).toContain("## Skill Drafts Pending");
    expect(result.content).toContain("No skill drafts pending.");
  });

  test("digest uses default skillDraftsDir when not specified", async () => {
    // Should not throw even without explicit skillDraftsDir
    const result = await generateDigest({ graphPath: graphDir });
    expect(result.content).toContain("## Skill Drafts Pending");
  });
});
