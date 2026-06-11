import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Server } from "bun";
import { writeSkillDraft } from "@litopys/extractor";
import type { SkillDraftMeta } from "@litopys/extractor";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function makeMeta(name: string, overrides?: Partial<SkillDraftMeta>): SkillDraftMeta {
  return {
    name,
    createdAt: new Date().toISOString(),
    episodeIds: ["ep-1", "ep-2"],
    sessions: ["sess-a", "sess-b"],
    model: "test-model",
    status: "pending",
    ...overrides,
  };
}

const SAMPLE_SKILL_MD = `---
name: test-skill
description: Trigger condition: when testing skill drafts.
---

# Test Skill

## When to use

Используется при тестировании.

## Procedure

1. Запусти тест.
2. Проверь результат.

## Pitfalls

Нет известных подводных камней.

## Verification

Тест зелёный — значит всё в порядке.
`;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("viewer skills API", () => {
  let tmpDir: string;
  let graphDir: string;
  let quarantineSkillsDir: string;
  let skillsDir: string;
  let server: Server<undefined>;
  let base: string;

  const TEST_TOKEN = "test-skills-token";
  const authedHeaders = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${TEST_TOKEN}`,
    ...extra,
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-viewer-skills-"));
    graphDir = path.join(tmpDir, "graph");
    quarantineSkillsDir = path.join(tmpDir, "quarantine", "skills");
    skillsDir = path.join(tmpDir, "skills");
    await fs.mkdir(graphDir, { recursive: true });
    await fs.mkdir(quarantineSkillsDir, { recursive: true });
    await fs.mkdir(skillsDir, { recursive: true });

    process.env.LITOPYS_GRAPH_PATH = graphDir;
    process.env.LITOPYS_QUARANTINE_SKILLS_DIR = quarantineSkillsDir;
    process.env.LITOPYS_SKILLS_DIR = skillsDir;

    // Fresh module import to bust module-level caches.
    const ts = Date.now();
    const modUrl = new URL(`../src/server.ts?cachebust=${ts}-${Math.random()}`, import.meta.url);
    const { createServer } = (await import(modUrl.href)) as typeof import("../src/server.ts");
    server = createServer({
      port: 0,
      bindAddr: "127.0.0.1",
      auth: { mode: "writable", token: TEST_TOKEN },
    });
    base = `http://localhost:${server.port}`;
  });

  afterEach(async () => {
    server.stop(true);
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env.LITOPYS_GRAPH_PATH;
    delete process.env.LITOPYS_QUARANTINE_SKILLS_DIR;
    delete process.env.LITOPYS_SKILLS_DIR;
  });

  // -------------------------------------------------------------------------
  // GET /api/skills
  // -------------------------------------------------------------------------

  test("GET /api/skills returns [] when no drafts exist", async () => {
    const res = await fetch(`${base}/api/skills`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("GET /api/skills returns draft list with meta and description", async () => {
    await writeSkillDraft("test-skill", SAMPLE_SKILL_MD, makeMeta("test-skill"), quarantineSkillsDir);

    const res = await fetch(`${base}/api/skills`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      meta: SkillDraftMeta;
      description: string;
    }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.meta.name).toBe("test-skill");
    expect(body[0]!.description).toBe("Trigger condition: when testing skill drafts.");
  });

  test("GET /api/skills does not require auth", async () => {
    // No auth header — should still return 200
    const res = await fetch(`${base}/api/skills`);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // GET /api/skills/:name — read single draft
  // -------------------------------------------------------------------------

  test("GET /api/skills/:name returns skillMd and meta", async () => {
    await writeSkillDraft("test-skill", SAMPLE_SKILL_MD, makeMeta("test-skill"), quarantineSkillsDir);

    const res = await fetch(`${base}/api/skills/test-skill`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: SkillDraftMeta; skillMd: string };
    expect(body.meta.name).toBe("test-skill");
    expect(body.skillMd).toContain("## When to use");
  });

  test("GET /api/skills/:name returns 404 for missing draft", async () => {
    const res = await fetch(`${base}/api/skills/no-such-draft`);
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // POST /api/skills/promote
  // -------------------------------------------------------------------------

  test("POST /api/skills/promote installs the draft", async () => {
    await writeSkillDraft("test-skill", SAMPLE_SKILL_MD, makeMeta("test-skill"), quarantineSkillsDir);

    const res = await fetch(`${base}/api/skills/promote`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "test-skill" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; installedTo: string };
    expect(body.ok).toBe(true);
    expect(body.installedTo).toContain("test-skill");

    // Draft should be gone from quarantine
    const listRes = await fetch(`${base}/api/skills`);
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(0);

    // Skill file should exist in skillsDir
    const skillFile = path.join(skillsDir, "test-skill", "SKILL.md");
    const exists = await fs.access(skillFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test("POST /api/skills/promote returns 409 when target already exists (no force)", async () => {
    // First, promote to create the installed skill
    await writeSkillDraft("my-skill", SAMPLE_SKILL_MD, makeMeta("my-skill"), quarantineSkillsDir);
    const firstPromote = await fetch(`${base}/api/skills/promote`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "my-skill" }),
    });
    expect(firstPromote.status).toBe(200);

    // Write a second draft with same name
    await writeSkillDraft("my-skill", SAMPLE_SKILL_MD, makeMeta("my-skill"), quarantineSkillsDir);

    // Promote again without force → 409
    const secondPromote = await fetch(`${base}/api/skills/promote`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "my-skill" }),
    });
    expect(secondPromote.status).toBe(409);
  });

  test("POST /api/skills/promote with force=true overwrites existing skill", async () => {
    await writeSkillDraft("force-skill", SAMPLE_SKILL_MD, makeMeta("force-skill"), quarantineSkillsDir);
    // First promote
    const r1 = await fetch(`${base}/api/skills/promote`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "force-skill" }),
    });
    expect(r1.status).toBe(200);

    // Write second draft with same name
    await writeSkillDraft("force-skill", SAMPLE_SKILL_MD, makeMeta("force-skill"), quarantineSkillsDir);

    // Promote with force → 200
    const r2 = await fetch(`${base}/api/skills/promote`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "force-skill", force: true }),
    });
    expect(r2.status).toBe(200);
  });

  test("POST /api/skills/promote returns 404 for missing draft", async () => {
    const res = await fetch(`${base}/api/skills/promote`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "nonexistent-draft" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/skills/promote requires auth", async () => {
    const res = await fetch(`${base}/api/skills/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "some-skill" }),
    });
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // POST /api/skills/reject
  // -------------------------------------------------------------------------

  test("POST /api/skills/reject removes the draft", async () => {
    await writeSkillDraft("test-skill", SAMPLE_SKILL_MD, makeMeta("test-skill"), quarantineSkillsDir);

    const res = await fetch(`${base}/api/skills/reject`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "test-skill", reason: "not useful" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Draft should be gone
    const listRes = await fetch(`${base}/api/skills`);
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  test("POST /api/skills/reject returns 404 for missing draft", async () => {
    const res = await fetch(`${base}/api/skills/reject`, {
      method: "POST",
      headers: authedHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "ghost-skill" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/skills/reject requires auth", async () => {
    const res = await fetch(`${base}/api/skills/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "some-skill" }),
    });
    expect(res.status).toBe(401);
  });
});
