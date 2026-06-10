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
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Machine-readable error codes attached to every domain throw site:
 * - EINVALIDNAME — name failed the kebab-case whitelist
 * - ENOTFOUND    — draft directory / SKILL.md missing
 * - ECORRUPT     — draft dir exists but meta.json is missing or unparseable
 * - ECONFLICT    — skill already installed and force not given
 */
export type SkillDraftErrorCode = "EINVALIDNAME" | "ENOTFOUND" | "ECORRUPT" | "ECONFLICT";

function draftError(code: SkillDraftErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

// ---------------------------------------------------------------------------
// Traversal protection
// ---------------------------------------------------------------------------

/**
 * Valid draft names — what normalizeSkillName() produces: lowercase
 * kebab-case starting with [a-z0-9]. A whitelist (not blacklist), because a
 * blacklist let "." and "" through: path.join(qsDir, ".") resolves to qsDir
 * itself, and rejectSkillDraft would then fs.rm -r the ENTIRE drafts
 * directory.
 */
const VALID_DRAFT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Sanitize a draft name via whitelist. Throws unless the name matches
 * VALID_DRAFT_NAME — rejects "", ".", "..", slashes, backslashes, uppercase.
 */
function sanitizeName(name: string): string {
  if (!VALID_DRAFT_NAME.test(name)) {
    throw draftError("EINVALIDNAME", `invalid skill draft name: "${name}"`);
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

  // Sort by createdAt (oldest first). NaN guard: invalid/missing createdAt
  // falls back to 0 so such drafts sort to the FRONT instead of poisoning
  // the comparator (NaN comparisons make sort order undefined).
  results.sort((a, b) => {
    const ta = new Date(a.meta.createdAt).getTime() || 0;
    const tb = new Date(b.meta.createdAt).getTime() || 0;
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
 * - Name must match the kebab-case whitelist (EINVALIDNAME).
 * - Throws "skill draft not found: <name>" (ENOTFOUND) when the draft
 *   directory or SKILL.md does not exist.
 * - Throws "skill draft corrupt: <name>" (ECORRUPT) when the draft dir
 *   exists but meta.json is missing or unparseable.
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
    throw draftError("ENOTFOUND", `skill draft not found: ${name}`);
  }

  try {
    await fs.access(skillMdPath);
  } catch {
    throw draftError("ENOTFOUND", `skill draft not found: ${name}`);
  }

  const skillMd = await fs.readFile(skillMdPath, "utf-8");

  // Draft dir exists — a missing or unparseable meta.json is a corrupt
  // draft, not a missing one. Don't leak raw ENOENT / SyntaxError.
  let meta: SkillDraftMeta;
  try {
    const metaRaw = await fs.readFile(metaPath, "utf-8");
    meta = JSON.parse(metaRaw) as SkillDraftMeta;
  } catch {
    throw draftError("ECORRUPT", `skill draft corrupt: ${name}`);
  }

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
 *     (ECONFLICT)
 *   - with force    → overwrites (target cleared first, no orphan files)
 *
 * On success:
 *   1. Copies files (SKILL.md + any auxiliary files, NO meta.json)
 *   2. Appends a line to <qsDir>/../promoted.jsonl
 *   3. Removes the draft directory
 *
 * Note: promoted.jsonl is anchored to qsDir — callers passing a custom qsDir
 * get promoted.jsonl next to it, which is asymmetric with rejected.jsonl
 * (anchored to graphPath in rejectSkillDraft).
 *
 * A crash between steps leaves the draft in place — promote never loses
 * data and is re-runnable (with force if the copy completed).
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

  // Existence check: missing draft dir → ENOTFOUND.
  let draftStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    draftStat = await fs.stat(draftDir);
  } catch {
    throw draftError("ENOTFOUND", `skill draft not found: ${name}`);
  }
  if (!draftStat.isDirectory()) {
    throw draftError("ENOTFOUND", `skill draft not found: ${name}`);
  }

  // Draft dir exists — missing or unparseable meta.json is a corrupt draft.
  // Don't leak raw ENOENT / SyntaxError.
  const metaPath = path.join(draftDir, "meta.json");
  let meta: SkillDraftMeta;
  try {
    const metaRaw = await fs.readFile(metaPath, "utf-8");
    meta = JSON.parse(metaRaw) as SkillDraftMeta;
  } catch {
    throw draftError("ECORRUPT", `skill draft corrupt: ${name}`);
  }

  // Check for existing install
  let targetExists = false;
  try {
    await fs.access(installDir);
    targetExists = true;
  } catch {
    // not installed yet
  }

  if (targetExists && !opts?.force) {
    throw draftError("ECONFLICT", `skill already installed: ${name} (use force)`);
  }

  // Force overwrite: clear the existing target first so stale files from the
  // old skill version don't survive as orphans.
  if (targetExists) {
    await fs.rm(installDir, { recursive: true });
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
 * - Throws "skill draft not found: <name>" if the draft directory does not
 *   exist; nothing is logged in that case.
 * - The rejected.jsonl path is derived from graphPath (not qsDir), matching
 *   the convention in quarantine.ts:
 *   path.join(graphPath, "..", "quarantine", "rejected.jsonl").
 */
export async function rejectSkillDraft(
  name: string,
  qsDir: string,
  graphPath: string,
  reason?: string,
): Promise<void> {
  sanitizeName(name);

  const draftDir = path.join(qsDir, name);

  // Existence check BEFORE doing anything — missing draft must not produce a
  // rejection log entry or any FS mutation.
  let draftStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    draftStat = await fs.stat(draftDir);
  } catch {
    throw draftError("ENOTFOUND", `skill draft not found: ${name}`);
  }
  if (!draftStat.isDirectory()) {
    throw draftError("ENOTFOUND", `skill draft not found: ${name}`);
  }

  // Read meta to include episodeIds / sessions in the log entry
  const metaPath = path.join(draftDir, "meta.json");
  let meta: SkillDraftMeta | null = null;
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    meta = JSON.parse(raw) as SkillDraftMeta;
  } catch {
    // meta may be broken — still log the rejection and clean up
  }

  // Append to rejected.jsonl (mkdir -p the quarantine dir first — parity
  // with rejectCandidate in quarantine.ts)
  const quarantineDir = path.join(graphPath, "..", "quarantine");
  await fs.mkdir(quarantineDir, { recursive: true });
  const rejectedLog = path.join(quarantineDir, "rejected.jsonl");
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
  await fs.rm(draftDir, { recursive: true });
}
