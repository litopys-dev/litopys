/**
 * skill-quarantine.ts — Skill draft quarantine layer (Task 9).
 *
 * Provides list / read / promote / reject operations for SKILL.md drafts
 * written by writeSkillDraft() in skill-draft.ts.
 *
 * All paths are explicit parameters — no hidden global state.
 * Default quarantine dir: <graphParent>/quarantine/skills/
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { defaultGraphPath } from "@litopys/core";
import type { SkillDraftMeta } from "./skill-draft.ts";

// ---------------------------------------------------------------------------
// Default path
// ---------------------------------------------------------------------------

/**
 * Returns the default quarantine skills directory:
 *   ~/.litopys/quarantine/skills  (or LITOPYS_GRAPH_PATH/../quarantine/skills)
 */
export function defaultQuarantineSkillsDir(): string {
  return path.join(defaultGraphPath(), "..", "quarantine", "skills");
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

/**
 * Extract the value of `description:` from SKILL.md frontmatter (the first
 * --- ... --- block). Uses a simple regex — no yaml library needed.
 *
 * Returns "" when frontmatter is absent, malformed, or the field is missing.
 */
function extractDescription(skillMd: string): string {
  // Match the first YAML frontmatter block
  const fmMatch = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch || !fmMatch[1]) return "";

  const block = fmMatch[1];
  // Match "description: value" — value may span to end of line
  const descMatch = block.match(/^description:\s*(.+)$/m);
  if (!descMatch || !descMatch[1]) return "";

  return descMatch[1].trim();
}

// ---------------------------------------------------------------------------
// Traversal protection
// ---------------------------------------------------------------------------

/**
 * Sanitize a draft name, rejecting path traversal attempts.
 * Throws for names containing "/", "\\", or "..".
 */
function sanitizeName(name: string): string {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`invalid skill draft name: "${name}"`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// listSkillDrafts
// ---------------------------------------------------------------------------

/**
 * List all pending skill drafts in the quarantine skills directory.
 *
 * - Each draft is a subdirectory containing meta.json + SKILL.md.
 * - Results are sorted by meta.createdAt (oldest first).
 * - Drafts with missing SKILL.md or broken meta.json are skipped with a
 *   stderr warning using the [litopys/skills] prefix.
 * - Returns [] for a non-existent or empty directory.
 */
export async function listSkillDrafts(
  qsDir: string,
): Promise<Array<{ meta: SkillDraftMeta; description: string }>> {
  let entries: string[];
  try {
    entries = await fs.readdir(qsDir);
  } catch {
    return [];
  }

  const results: Array<{ meta: SkillDraftMeta; description: string }> = [];

  for (const entry of entries) {
    const draftDir = path.join(qsDir, entry);

    // Only consider directories
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(draftDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const metaPath = path.join(draftDir, "meta.json");
    const skillMdPath = path.join(draftDir, "SKILL.md");

    // Check SKILL.md exists
    try {
      await fs.access(skillMdPath);
    } catch {
      process.stderr.write(
        `[litopys/skills] skipping draft "${entry}": SKILL.md not found\n`,
      );
      continue;
    }

    // Parse meta.json
    let meta: SkillDraftMeta;
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      meta = JSON.parse(raw) as SkillDraftMeta;
    } catch {
      process.stderr.write(
        `[litopys/skills] skipping draft "${entry}": broken or missing meta.json\n`,
      );
      continue;
    }

    // Extract description from SKILL.md frontmatter
    let description = "";
    try {
      const skillMd = await fs.readFile(skillMdPath, "utf-8");
      description = extractDescription(skillMd);
    } catch {
      // description stays ""
    }

    results.push({ meta, description });
  }

  // Sort by createdAt (oldest first)
  results.sort((a, b) => {
    const ta = new Date(a.meta.createdAt).getTime();
    const tb = new Date(b.meta.createdAt).getTime();
    return ta - tb;
  });

  return results;
}

// ---------------------------------------------------------------------------
// readSkillDraft
// ---------------------------------------------------------------------------

/**
 * Read a specific skill draft by name.
 *
 * - Rejects names with "/" , "\\" or ".." (path traversal protection).
 * - Throws "skill draft not found: <name>" when the draft directory or
 *   SKILL.md does not exist.
 */
export async function readSkillDraft(
  name: string,
  qsDir: string,
): Promise<{ meta: SkillDraftMeta; skillMd: string }> {
  sanitizeName(name);

  const draftDir = path.join(qsDir, name);
  const metaPath = path.join(draftDir, "meta.json");
  const skillMdPath = path.join(draftDir, "SKILL.md");

  // Check existence
  try {
    await fs.access(draftDir);
  } catch {
    throw new Error(`skill draft not found: ${name}`);
  }

  try {
    await fs.access(skillMdPath);
  } catch {
    throw new Error(`skill draft not found: ${name}`);
  }

  const [metaRaw, skillMd] = await Promise.all([
    fs.readFile(metaPath, "utf-8"),
    fs.readFile(skillMdPath, "utf-8"),
  ]);

  const meta = JSON.parse(metaRaw) as SkillDraftMeta;
  return { meta, skillMd };
}

// ---------------------------------------------------------------------------
// promoteSkillDraft
// ---------------------------------------------------------------------------

/**
 * Promote a skill draft from quarantine to the installed skills directory.
 *
 * Copies all files EXCEPT meta.json to <skillsDir>/<name>/.
 * If the target directory already exists:
 *   - without force → throws "skill already installed: <name> (use force)"
 *   - with force    → overwrites
 *
 * On success:
 *   1. Copies files (SKILL.md + any auxiliary files, NO meta.json)
 *   2. Appends a line to <qsDir>/../promoted.jsonl
 *   3. Removes the draft directory
 *
 * Returns the installed path (<skillsDir>/<name>).
 */
export async function promoteSkillDraft(
  name: string,
  qsDir: string,
  skillsDir: string,
  opts?: { force?: boolean },
): Promise<string> {
  sanitizeName(name);

  const draftDir = path.join(qsDir, name);
  const installDir = path.join(skillsDir, name);

  // Read meta before touching the FS (ensures draft exists)
  const metaPath = path.join(draftDir, "meta.json");
  const metaRaw = await fs.readFile(metaPath, "utf-8").catch(() => {
    throw new Error(`skill draft not found: ${name}`);
  });
  const meta = JSON.parse(metaRaw) as SkillDraftMeta;

  // Check for existing install
  let targetExists = false;
  try {
    await fs.access(installDir);
    targetExists = true;
  } catch {
    // not installed yet
  }

  if (targetExists && !opts?.force) {
    throw new Error(`skill already installed: ${name} (use force)`);
  }

  // Prepare target directory
  await fs.mkdir(installDir, { recursive: true });

  // Copy entries one by one, skipping meta.json
  const entries = await fs.readdir(draftDir);
  for (const entry of entries) {
    if (entry === "meta.json") continue;
    const src = path.join(draftDir, entry);
    const dst = path.join(installDir, entry);
    const entryStat = await fs.stat(src);
    if (entryStat.isDirectory()) {
      await fs.cp(src, dst, { recursive: true });
    } else {
      await fs.copyFile(src, dst);
    }
  }

  // Append to promoted.jsonl
  const promotedLog = path.join(qsDir, "..", "promoted.jsonl");
  const promotedEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    name,
    episodeIds: meta.episodeIds,
    sessions: meta.sessions,
    installedTo: installDir,
  });
  await fs.appendFile(promotedLog, `${promotedEntry}\n`, "utf-8");

  // Remove draft directory
  await fs.rm(draftDir, { recursive: true });

  return installDir;
}

// ---------------------------------------------------------------------------
// rejectSkillDraft
// ---------------------------------------------------------------------------

/**
 * Reject a skill draft — logs to quarantine/rejected.jsonl and removes the
 * draft directory.
 *
 * The rejected.jsonl path is derived from graphPath (not qsDir), matching the
 * convention in quarantine.ts: path.join(graphPath, "..", "quarantine", "rejected.jsonl").
 */
export async function rejectSkillDraft(
  name: string,
  qsDir: string,
  graphPath: string,
  reason?: string,
): Promise<void> {
  sanitizeName(name);

  const draftDir = path.join(qsDir, name);

  // Read meta to include episodeIds / sessions in the log entry
  const metaPath = path.join(draftDir, "meta.json");
  let meta: SkillDraftMeta | null = null;
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    meta = JSON.parse(raw) as SkillDraftMeta;
  } catch {
    // draft may not exist or meta may be broken — still try to clean up
  }

  // Append to rejected.jsonl (existing file required by spec)
  const rejectedLog = path.join(graphPath, "..", "quarantine", "rejected.jsonl");
  const rejectedEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    kind: "skill",
    name,
    reason: reason ?? null,
    episodeIds: meta?.episodeIds ?? [],
    sessions: meta?.sessions ?? [],
  });
  await fs.appendFile(rejectedLog, `${rejectedEntry}\n`, "utf-8");

  // Remove draft directory
  try {
    await fs.rm(draftDir, { recursive: true });
  } catch {
    // already gone — that's fine
  }
}
