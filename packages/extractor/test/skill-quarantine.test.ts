/**
 * skill-quarantine.test.ts — Tests for Task 9: skill draft quarantine layer.
 *
 * Uses tmp-dirs (mkdtemp) and writeSkillDraft from skill-draft.ts as the
 * fixture helper to avoid duplicating the "write a draft" logic.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { writeSkillDraft } from "../src/skill-draft.ts";
import type { SkillDraftMeta } from "../src/skill-draft.ts";
import {
  defaultQuarantineSkillsDir,
  listSkillDrafts,
  promoteSkillDraft,
  readSkillDraft,
  rejectSkillDraft,
} from "../src/skill-quarantine.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid SKILL.md with a `description:` frontmatter field. */
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
    sessions: ["sess-A", "sess-B"],
    model: "mock-v1",
    status: "pending",
    ...overrides,
  };
}

/** Create a temp dir structured like a real quarantine setup:
 *   <root>/quarantine/skills/   ← qsDir
 *   <root>/quarantine/          ← contains promoted.jsonl / rejected.jsonl
 *   <root>/graph/               ← graphPath (so graphPath/../quarantine/ resolves correctly)
 *
 * Returns { root, qsDir, graphPath }
 */
async function mkQuarantineFixture(): Promise<{ root: string; qsDir: string; graphPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-sq-test-"));
  const qsDir = path.join(root, "quarantine", "skills");
  const graphPath = path.join(root, "graph");
  await fs.mkdir(qsDir, { recursive: true });
  await fs.mkdir(graphPath, { recursive: true });
  // Create the quarantine dir (parent of skills/) for log files
  await fs.mkdir(path.join(root, "quarantine"), { recursive: true });
  return { root, qsDir, graphPath };
}

async function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "litopys-sq-test-"));
}

/** Await a promise expected to reject; return the error (with optional code). */
async function errOf(p: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error("expected promise to reject, but it resolved");
}

// ---------------------------------------------------------------------------
// defaultQuarantineSkillsDir
// ---------------------------------------------------------------------------

describe("defaultQuarantineSkillsDir", () => {
  test("returns a non-empty string ending with quarantine/skills", () => {
    const dir = defaultQuarantineSkillsDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
    // Normalize separators for cross-platform
    const normalized = dir.replace(/\\/g, "/");
    expect(normalized).toContain("quarantine/skills");
  });
});

// ---------------------------------------------------------------------------
// listSkillDrafts
// ---------------------------------------------------------------------------

describe("listSkillDrafts", () => {
  test("empty directory → []", async () => {
    const tmpDir = await mkTmp();
    try {
      const results = await listSkillDrafts(tmpDir);
      expect(results).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("non-existent directory → []", async () => {
    const results = await listSkillDrafts("/tmp/litopys-sq-does-not-exist-xyz123");
    expect(results).toEqual([]);
  });

  test("single draft → 1 result with correct meta and description", async () => {
    const tmpDir = await mkTmp();
    try {
      const name = "my-skill";
      const description = "Use when deploying to production.";
      await writeSkillDraft(name, makeSkillMd(name, description), makeMeta(name), tmpDir);

      const results = await listSkillDrafts(tmpDir);
      expect(results).toHaveLength(1);
      const first = results[0];
      expect(first?.meta.name).toBe(name);
      expect(first?.meta.status).toBe("pending");
      expect(first?.description).toBe(description);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("two drafts → sorted by createdAt (oldest first)", async () => {
    const tmpDir = await mkTmp();
    try {
      const nameA = "skill-older";
      const nameB = "skill-newer";
      // Older draft
      await writeSkillDraft(
        nameA,
        makeSkillMd(nameA),
        makeMeta(nameA, { createdAt: "2026-06-01T08:00:00.000Z" }),
        tmpDir,
      );
      // Newer draft
      await writeSkillDraft(
        nameB,
        makeSkillMd(nameB),
        makeMeta(nameB, { createdAt: "2026-06-10T12:00:00.000Z" }),
        tmpDir,
      );

      const results = await listSkillDrafts(tmpDir);
      expect(results).toHaveLength(2);
      expect(results[0]?.meta.name).toBe(nameA);
      expect(results[1]?.meta.name).toBe(nameB);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("SKILL.md with no description field → description is ''", async () => {
    const tmpDir = await mkTmp();
    try {
      const name = "no-desc-skill";
      const skillMdNoDesc = `---
name: ${name}
---

# ${name}

## When to use

Когда нужно.

## Procedure

1. Шаг один.

## Pitfalls

Нет.

## Verification

Готово.
`;
      await writeSkillDraft(name, skillMdNoDesc, makeMeta(name), tmpDir);
      const results = await listSkillDrafts(tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0]?.description).toBe("");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("missing createdAt in meta → sorts to the FRONT (NaN guard)", async () => {
    const tmpDir = await mkTmp();
    try {
      // Valid draft with a normal createdAt
      await writeSkillDraft(
        "dated-skill",
        makeSkillMd("dated-skill"),
        makeMeta("dated-skill", { createdAt: "2026-06-10T12:00:00.000Z" }),
        tmpDir,
      );

      // Draft whose meta.json lacks createdAt entirely (hand-written/legacy)
      const undatedDir = path.join(tmpDir, "undated-skill");
      await fs.mkdir(undatedDir);
      await fs.writeFile(path.join(undatedDir, "SKILL.md"), makeSkillMd("undated-skill"), "utf-8");
      const metaNoDate = { ...makeMeta("undated-skill") } as Record<string, unknown>;
      delete metaNoDate.createdAt;
      await fs.writeFile(
        path.join(undatedDir, "meta.json"),
        JSON.stringify(metaNoDate, null, 2),
        "utf-8",
      );

      const results = await listSkillDrafts(tmpDir);
      expect(results).toHaveLength(2);
      // Missing createdAt → timestamp falls back to 0 → first in the list
      expect(results[0]?.meta.name).toBe("undated-skill");
      expect(results[1]?.meta.name).toBe("dated-skill");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("broken meta.json → draft skipped with warning, valid neighbor survives", async () => {
    const tmpDir = await mkTmp();
    const stderrLines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    // Capture stderr output
    process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
      stderrLines.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    };
    try {
      // Create a valid draft
      await writeSkillDraft(
        "good-skill",
        makeSkillMd("good-skill"),
        makeMeta("good-skill"),
        tmpDir,
      );

      // Manually create a broken draft
      const brokenDir = path.join(tmpDir, "broken-skill");
      await fs.mkdir(brokenDir);
      await fs.writeFile(path.join(brokenDir, "meta.json"), "{ invalid json }", "utf-8");
      await fs.writeFile(path.join(brokenDir, "SKILL.md"), makeSkillMd("broken-skill"), "utf-8");

      const results = await listSkillDrafts(tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0]?.meta.name).toBe("good-skill");

      const warnings = stderrLines.join("");
      expect(warnings).toContain("[litopys/skills]");
      expect(warnings).toContain("broken-skill");
    } finally {
      process.stderr.write = originalWrite;
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("missing SKILL.md → draft skipped with warning", async () => {
    const tmpDir = await mkTmp();
    const stderrLines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
      stderrLines.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    };
    try {
      // Create draft directory with meta.json but no SKILL.md
      const draftDir = path.join(tmpDir, "no-skill-md");
      await fs.mkdir(draftDir);
      await fs.writeFile(
        path.join(draftDir, "meta.json"),
        JSON.stringify(makeMeta("no-skill-md"), null, 2),
        "utf-8",
      );

      const results = await listSkillDrafts(tmpDir);
      expect(results).toHaveLength(0);
      expect(stderrLines.join("")).toContain("SKILL.md not found");
    } finally {
      process.stderr.write = originalWrite;
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// readSkillDraft
// ---------------------------------------------------------------------------

describe("readSkillDraft", () => {
  test("happy path — returns meta and skillMd content", async () => {
    const tmpDir = await mkTmp();
    try {
      const name = "read-test-skill";
      const md = makeSkillMd(name);
      await writeSkillDraft(name, md, makeMeta(name), tmpDir);

      const { meta, skillMd } = await readSkillDraft(name, tmpDir);
      expect(meta.name).toBe(name);
      expect(meta.status).toBe("pending");
      expect(skillMd).toBe(md);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("non-existent name → throws 'skill draft not found: <name>' with code ENOTFOUND", async () => {
    const tmpDir = await mkTmp();
    try {
      const err = await errOf(readSkillDraft("ghost-skill", tmpDir));
      expect(err.message).toBe("skill draft not found: ghost-skill");
      expect(err.code).toBe("ENOTFOUND");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("missing meta.json (SKILL.md present) → 'skill draft corrupt' with code ECORRUPT", async () => {
    const tmpDir = await mkTmp();
    try {
      const name = "half-broken";
      const draftDir = path.join(tmpDir, name);
      await fs.mkdir(draftDir);
      await fs.writeFile(path.join(draftDir, "SKILL.md"), makeSkillMd(name), "utf-8");

      const err = await errOf(readSkillDraft(name, tmpDir));
      expect(err.message).toBe(`skill draft corrupt: ${name}`);
      expect(err.code).toBe("ECORRUPT");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("corrupt JSON in meta.json → 'skill draft corrupt' with code ECORRUPT", async () => {
    const tmpDir = await mkTmp();
    try {
      const name = "bad-meta";
      const draftDir = path.join(tmpDir, name);
      await fs.mkdir(draftDir);
      await fs.writeFile(path.join(draftDir, "SKILL.md"), makeSkillMd(name), "utf-8");
      await fs.writeFile(path.join(draftDir, "meta.json"), "{ not json !!", "utf-8");

      const err = await errOf(readSkillDraft(name, tmpDir));
      expect(err.message).toBe(`skill draft corrupt: ${name}`);
      expect(err.code).toBe("ECORRUPT");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  test("traversal name '../x' → throws invalid skill draft name with code EINVALIDNAME", async () => {
    const err = await errOf(readSkillDraft("../x", "/tmp"));
    expect(err.message).toContain("invalid skill draft name");
    expect(err.code).toBe("EINVALIDNAME");
  });

  test("traversal name 'a/b' → throws invalid skill draft name", async () => {
    await expect(readSkillDraft("a/b", "/tmp")).rejects.toThrow("invalid skill draft name");
  });

  test("name with backslash → throws invalid skill draft name", async () => {
    await expect(readSkillDraft("a\\b", "/tmp")).rejects.toThrow("invalid skill draft name");
  });
});

// ---------------------------------------------------------------------------
// Name whitelist — read, promote AND reject must all refuse bad names
// ---------------------------------------------------------------------------

describe("draft name whitelist", () => {
  const badNames = [".", "", "UPPER", "a/b", "../x", "..", "a\\b", "-leading-dash"];

  for (const bad of badNames) {
    test(`readSkillDraft(${JSON.stringify(bad)}) → throws invalid name`, async () => {
      await expect(readSkillDraft(bad, "/tmp")).rejects.toThrow("invalid skill draft name");
    });

    test(`promoteSkillDraft(${JSON.stringify(bad)}) → throws invalid name`, async () => {
      await expect(promoteSkillDraft(bad, "/tmp", "/tmp")).rejects.toThrow(
        "invalid skill draft name",
      );
    });

    test(`rejectSkillDraft(${JSON.stringify(bad)}) → throws invalid name`, async () => {
      await expect(rejectSkillDraft(bad, "/tmp", "/tmp")).rejects.toThrow(
        "invalid skill draft name",
      );
    });
  }

  test("'.' as name must NOT delete the drafts directory", async () => {
    const { root, qsDir, graphPath } = await mkQuarantineFixture();
    try {
      // A real draft lives in qsDir; rejecting "." used to rm -r qsDir itself
      await writeSkillDraft("survivor", makeSkillMd("survivor"), makeMeta("survivor"), qsDir);

      await expect(rejectSkillDraft(".", qsDir, graphPath)).rejects.toThrow(
        "invalid skill draft name",
      );

      // Drafts directory and its content intact
      await expect(fs.access(path.join(qsDir, "survivor", "SKILL.md"))).resolves.toBeNull();
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// promoteSkillDraft
// ---------------------------------------------------------------------------

describe("promoteSkillDraft", () => {
  test("full promote cycle: draft created → promoted → SKILL.md in skillsDir, no meta.json, draft removed, promoted.jsonl has entry", async () => {
    const { root, qsDir } = await mkQuarantineFixture();
    const tmpSkills = await mkTmp();
    try {
      const name = "promote-me";
      const md = makeSkillMd(name);
      const meta = makeMeta(name, { episodeIds: ["ep-aaa"], sessions: ["sess-X"] });
      await writeSkillDraft(name, md, meta, qsDir);

      const installPath = await promoteSkillDraft(name, qsDir, tmpSkills);

      // Returns correct install path
      expect(installPath).toBe(path.join(tmpSkills, name));

      // SKILL.md present in skillsDir
      const installedMd = await fs.readFile(path.join(tmpSkills, name, "SKILL.md"), "utf-8");
      expect(installedMd).toBe(md);

      // meta.json NOT present in skillsDir
      await expect(fs.access(path.join(tmpSkills, name, "meta.json"))).rejects.toThrow();

      // Draft directory removed
      await expect(fs.access(path.join(qsDir, name))).rejects.toThrow();

      // promoted.jsonl contains an entry
      const promotedLog = path.join(qsDir, "..", "promoted.jsonl");
      const logContent = await fs.readFile(promotedLog, "utf-8");
      const entry = JSON.parse(logContent.trim()) as Record<string, unknown>;
      expect(entry.name).toBe(name);
      expect(entry.episodeIds).toEqual(["ep-aaa"]);
      expect(entry.sessions).toEqual(["sess-X"]);
      expect(entry.installedTo).toBe(path.join(tmpSkills, name));
      expect(typeof entry.timestamp).toBe("string");
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(tmpSkills, { recursive: true });
    }
  });

  test("existing install without force → throws, draft is untouched", async () => {
    const { root, qsDir } = await mkQuarantineFixture();
    const tmpSkills = await mkTmp();
    try {
      const name = "conflict-skill";
      await writeSkillDraft(name, makeSkillMd(name), makeMeta(name), qsDir);

      // Pre-create the target directory
      await fs.mkdir(path.join(tmpSkills, name), { recursive: true });
      await fs.writeFile(path.join(tmpSkills, name, "SKILL.md"), "existing content", "utf-8");

      const err = await errOf(promoteSkillDraft(name, qsDir, tmpSkills));
      expect(err.message).toBe(`skill already installed: ${name} (use force)`);
      expect(err.code).toBe("ECONFLICT");

      // Draft still exists (access resolves to null in Bun, doesn't throw)
      await expect(fs.access(path.join(qsDir, name))).resolves.toBeNull();

      // Original installed content untouched
      const existing = await fs.readFile(path.join(tmpSkills, name, "SKILL.md"), "utf-8");
      expect(existing).toBe("existing content");
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(tmpSkills, { recursive: true });
    }
  });

  test("existing install with force → overwrites successfully", async () => {
    const { root, qsDir } = await mkQuarantineFixture();
    const tmpSkills = await mkTmp();
    try {
      const name = "force-skill";
      const md = makeSkillMd(name);
      await writeSkillDraft(name, md, makeMeta(name), qsDir);

      // Pre-create the target directory with stale content
      await fs.mkdir(path.join(tmpSkills, name), { recursive: true });
      await fs.writeFile(path.join(tmpSkills, name, "SKILL.md"), "stale content", "utf-8");

      const installPath = await promoteSkillDraft(name, qsDir, tmpSkills, { force: true });
      expect(installPath).toBe(path.join(tmpSkills, name));

      const installed = await fs.readFile(path.join(tmpSkills, name, "SKILL.md"), "utf-8");
      expect(installed).toBe(md);
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(tmpSkills, { recursive: true });
    }
  });

  test("force promote clears stale files in target dir (no orphans from old version)", async () => {
    const { root, qsDir } = await mkQuarantineFixture();
    const tmpSkills = await mkTmp();
    try {
      const name = "force-clean-skill";
      const md = makeSkillMd(name);
      await writeSkillDraft(name, md, makeMeta(name), qsDir);

      // Pre-create target with an old-version file that the new draft doesn't have
      await fs.mkdir(path.join(tmpSkills, name), { recursive: true });
      await fs.writeFile(path.join(tmpSkills, name, "SKILL.md"), "stale content", "utf-8");
      await fs.writeFile(path.join(tmpSkills, name, "old-file.md"), "orphan from v1", "utf-8");

      await promoteSkillDraft(name, qsDir, tmpSkills, { force: true });

      // New SKILL.md present
      const installed = await fs.readFile(path.join(tmpSkills, name, "SKILL.md"), "utf-8");
      expect(installed).toBe(md);

      // Stale old-file.md is GONE
      await expect(fs.access(path.join(tmpSkills, name, "old-file.md"))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(tmpSkills, { recursive: true });
    }
  });

  test("auxiliary file (reference.md) is copied, meta.json is NOT copied", async () => {
    const { root, qsDir } = await mkQuarantineFixture();
    const tmpSkills = await mkTmp();
    try {
      const name = "aux-file-skill";
      const md = makeSkillMd(name);
      await writeSkillDraft(name, md, makeMeta(name), qsDir);

      // Add a reference.md auxiliary file alongside SKILL.md in the draft dir
      const refContent = "# Reference\n\nSome reference material.";
      await fs.writeFile(path.join(qsDir, name, "reference.md"), refContent, "utf-8");

      await promoteSkillDraft(name, qsDir, tmpSkills);

      // reference.md present
      const refInstalled = await fs.readFile(path.join(tmpSkills, name, "reference.md"), "utf-8");
      expect(refInstalled).toBe(refContent);

      // meta.json absent
      await expect(fs.access(path.join(tmpSkills, name, "meta.json"))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(tmpSkills, { recursive: true });
    }
  });

  test("traversal name in promote → throws", async () => {
    await expect(promoteSkillDraft("../evil", "/tmp", "/tmp")).rejects.toThrow(
      "invalid skill draft name",
    );
  });

  test("promote nonexistent draft → 'skill draft not found' with code ENOTFOUND", async () => {
    const { root, qsDir } = await mkQuarantineFixture();
    const tmpSkills = await mkTmp();
    try {
      const err = await errOf(promoteSkillDraft("ghost-promote", qsDir, tmpSkills));
      expect(err.message).toBe("skill draft not found: ghost-promote");
      expect(err.code).toBe("ENOTFOUND");
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(tmpSkills, { recursive: true });
    }
  });

  test("promote draft with missing meta.json → 'skill draft corrupt' with code ECORRUPT", async () => {
    const { root, qsDir } = await mkQuarantineFixture();
    const tmpSkills = await mkTmp();
    try {
      const name = "promote-half-broken";
      const draftDir = path.join(qsDir, name);
      await fs.mkdir(draftDir);
      await fs.writeFile(path.join(draftDir, "SKILL.md"), makeSkillMd(name), "utf-8");

      const err = await errOf(promoteSkillDraft(name, qsDir, tmpSkills));
      expect(err.message).toBe(`skill draft corrupt: ${name}`);
      expect(err.code).toBe("ECORRUPT");

      // Draft untouched, nothing installed
      await expect(fs.access(path.join(draftDir, "SKILL.md"))).resolves.toBeNull();
      await expect(fs.access(path.join(tmpSkills, name))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(tmpSkills, { recursive: true });
    }
  });

  test("promote draft with corrupt JSON meta → 'skill draft corrupt' with code ECORRUPT", async () => {
    const { root, qsDir } = await mkQuarantineFixture();
    const tmpSkills = await mkTmp();
    try {
      const name = "promote-bad-meta";
      const draftDir = path.join(qsDir, name);
      await fs.mkdir(draftDir);
      await fs.writeFile(path.join(draftDir, "SKILL.md"), makeSkillMd(name), "utf-8");
      await fs.writeFile(path.join(draftDir, "meta.json"), "%%% not json", "utf-8");

      const err = await errOf(promoteSkillDraft(name, qsDir, tmpSkills));
      expect(err.message).toBe(`skill draft corrupt: ${name}`);
      expect(err.code).toBe("ECORRUPT");
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(tmpSkills, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// rejectSkillDraft
// ---------------------------------------------------------------------------

describe("rejectSkillDraft", () => {
  test("draft removed and rejected.jsonl contains {kind:'skill', reason}", async () => {
    const { root, qsDir, graphPath } = await mkQuarantineFixture();
    // Pre-create rejected.jsonl as empty (spec: "append to EXISTING")
    const rejectedLog = path.join(graphPath, "..", "quarantine", "rejected.jsonl");
    await fs.writeFile(rejectedLog, "", "utf-8");

    try {
      const name = "reject-me";
      await writeSkillDraft(
        name,
        makeSkillMd(name),
        makeMeta(name, { episodeIds: ["ep-rej"], sessions: ["sess-R"] }),
        qsDir,
      );

      await rejectSkillDraft(name, qsDir, graphPath, "not useful");

      // Draft directory gone
      await expect(fs.access(path.join(qsDir, name))).rejects.toThrow();

      // rejected.jsonl has the entry
      const logContent = await fs.readFile(rejectedLog, "utf-8");
      const entry = JSON.parse(logContent.trim()) as Record<string, unknown>;
      expect(entry.kind).toBe("skill");
      expect(entry.name).toBe(name);
      expect(entry.reason).toBe("not useful");
      expect(entry.episodeIds).toEqual(["ep-rej"]);
      expect(entry.sessions).toEqual(["sess-R"]);
      expect(typeof entry.timestamp).toBe("string");
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });

  test("reject with no reason → reason: null in log", async () => {
    const { root, qsDir, graphPath } = await mkQuarantineFixture();
    const rejectedLog = path.join(graphPath, "..", "quarantine", "rejected.jsonl");
    await fs.writeFile(rejectedLog, "", "utf-8");

    try {
      const name = "no-reason-reject";
      await writeSkillDraft(name, makeSkillMd(name), makeMeta(name), qsDir);

      await rejectSkillDraft(name, qsDir, graphPath);

      const logContent = await fs.readFile(rejectedLog, "utf-8");
      const entry = JSON.parse(logContent.trim()) as Record<string, unknown>;
      expect(entry.reason).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });

  test("traversal name in reject → throws", async () => {
    await expect(rejectSkillDraft("../evil", "/tmp", "/tmp")).rejects.toThrow(
      "invalid skill draft name",
    );
  });

  test("reject nonexistent draft → throws 'skill draft not found', no log entry written", async () => {
    const { root, qsDir, graphPath } = await mkQuarantineFixture();
    const rejectedLog = path.join(graphPath, "..", "quarantine", "rejected.jsonl");
    try {
      await expect(rejectSkillDraft("ghost-draft", qsDir, graphPath, "whatever")).rejects.toThrow(
        "skill draft not found: ghost-draft",
      );

      // rejected.jsonl must not have been created
      await expect(fs.access(rejectedLog)).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });

  test("reject nonexistent draft with pre-existing log → log unchanged", async () => {
    const { root, qsDir, graphPath } = await mkQuarantineFixture();
    const rejectedLog = path.join(graphPath, "..", "quarantine", "rejected.jsonl");
    const priorContent = '{"timestamp":"2026-01-01T00:00:00.000Z","kind":"node"}\n';
    await fs.writeFile(rejectedLog, priorContent, "utf-8");
    try {
      await expect(rejectSkillDraft("ghost-draft", qsDir, graphPath)).rejects.toThrow(
        "skill draft not found: ghost-draft",
      );

      const after = await fs.readFile(rejectedLog, "utf-8");
      expect(after).toBe(priorContent);
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });

  test("reject creates quarantine dir if missing (mkdir -p parity with rejectCandidate)", async () => {
    // graphPath whose parent has NO quarantine dir yet for the log; the draft
    // itself lives in a separate qsDir.
    const { root, qsDir } = await mkQuarantineFixture();
    const isolatedRoot = await mkTmp();
    const isolatedGraph = path.join(isolatedRoot, "graph");
    await fs.mkdir(isolatedGraph, { recursive: true });
    try {
      const name = "mkdir-reject";
      await writeSkillDraft(name, makeSkillMd(name), makeMeta(name), qsDir);

      // No quarantine/ dir exists under isolatedRoot — must be created
      await rejectSkillDraft(name, qsDir, isolatedGraph, "test mkdir");

      const log = path.join(isolatedRoot, "quarantine", "rejected.jsonl");
      const entry = JSON.parse((await fs.readFile(log, "utf-8")).trim()) as Record<string, unknown>;
      expect(entry.kind).toBe("skill");
      expect(entry.name).toBe(name);

      // Draft removed
      await expect(fs.access(path.join(qsDir, name))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(isolatedRoot, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Full integration cycle
// ---------------------------------------------------------------------------

describe("full cycle integration", () => {
  test("writeSkillDraft → listSkillDrafts (1 item) → promote → installed, draft gone, promoted.jsonl", async () => {
    const { root, qsDir } = await mkQuarantineFixture();
    const tmpSkills = await mkTmp();
    try {
      const name = "full-cycle-skill";
      const description = "Full cycle integration test skill.";
      const md = makeSkillMd(name, description);
      const meta = makeMeta(name);

      // Write draft
      await writeSkillDraft(name, md, meta, qsDir);

      // List: should see 1
      const listed = await listSkillDrafts(qsDir);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.meta.name).toBe(name);
      expect(listed[0]?.description).toBe(description);

      // Promote
      const installPath = await promoteSkillDraft(name, qsDir, tmpSkills);
      expect(installPath).toBe(path.join(tmpSkills, name));

      // List: should be empty
      const afterPromote = await listSkillDrafts(qsDir);
      expect(afterPromote).toHaveLength(0);

      // SKILL.md at install path
      const installed = await fs.readFile(path.join(tmpSkills, name, "SKILL.md"), "utf-8");
      expect(installed).toBe(md);

      // promoted.jsonl has exactly 1 line
      const promotedLog = path.join(qsDir, "..", "promoted.jsonl");
      const lines = (await fs.readFile(promotedLog, "utf-8")).trim().split("\n");
      expect(lines).toHaveLength(1);
      const line0 = lines[0];
      const entry = JSON.parse(line0 as string) as Record<string, unknown>;
      expect(entry.name).toBe(name);
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rm(tmpSkills, { recursive: true });
    }
  });
});
