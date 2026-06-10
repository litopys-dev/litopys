import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { z } from "zod";
import { defaultGraphPath } from "@litopys/core";

// ---------------------------------------------------------------------------
// Schema & Types
// ---------------------------------------------------------------------------

export const EpisodeSchema = z.object({
  id: z.string(), // "ep-" + sha256(sessionId+goal).slice(0,12)
  sessionId: z.string(),
  date: z.string(), // YYYY-MM-DD
  goal: z.string().max(200),
  steps: z.array(z.string()).min(1).max(10),
  toolOps: z.number().int().min(0),
  errorRecovery: z.boolean(),
  project: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  clusteredInto: z.string().nullable().default(null),
});

export type Episode = z.infer<typeof EpisodeSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a stable episode id from sessionId and goal.
 * Format: "ep-" + first 12 hex chars of sha256(sessionId + goal).
 */
export function makeEpisodeId(sessionId: string, goal: string): string {
  const hash = crypto.createHash("sha256").update(sessionId + goal).digest("hex");
  return `ep-${hash.slice(0, 12)}`;
}

/**
 * Derive the monthly file name (YYYY-MM.jsonl) from an ISO date string.
 */
function monthlyFileName(date: string): string {
  return `${date.slice(0, 7)}.jsonl`;
}

/**
 * Parse a single JSONL line into an Episode, returning null on failure.
 * Invalid JSON or schema violations are silently skipped.
 */
function parseLine(line: string): Episode | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = EpisodeSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Read all valid episodes from a single JSONL file.
 * Invalid or corrupt lines are silently skipped.
 */
async function readEpisodesFromFile(filePath: string): Promise<Episode[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  return content
    .split("\n")
    .map(parseLine)
    .filter((ep): ep is Episode => ep !== null);
}

/**
 * Write episodes array back to a file atomically (tmp file + rename).
 */
async function writeEpisodesAtomic(filePath: string, episodes: Episode[]): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const content = episodes.map((ep) => JSON.stringify(ep)).join("\n") + (episodes.length > 0 ? "\n" : "");
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Determine which monthly JSONL files overlap with a [startDate, today] window.
 * Returns a Set of "YYYY-MM" strings.
 */
function monthsInWindow(sinceDays: number): Set<string> {
  const result = new Set<string>();
  const today = new Date();
  const start = new Date();
  start.setDate(start.getDate() - sinceDays);

  // Iterate month by month from start to today
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= today) {
    const yyyy = cursor.getFullYear().toString();
    const mm = String(cursor.getMonth() + 1).padStart(2, "0");
    result.add(`${yyyy}-${mm}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Default path
// ---------------------------------------------------------------------------

/**
 * Default episodes directory: sibling to the graph directory under ~/.litopys.
 */
export function defaultEpisodesDir(): string {
  return path.join(defaultGraphPath(), "..", "episodes");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append episodes to monthly JSONL files (one file per YYYY-MM).
 *
 * - Episodes are grouped by the `date` field and written to `YYYY-MM.jsonl`.
 * - Deduplication is performed by `id` against episodes already in the files.
 * - Returns the number of episodes actually written (new, non-duplicate ones).
 *
 * @param episodes   Episodes to store.
 * @param episodesDir  Directory where monthly .jsonl files live.
 */
export async function appendEpisodes(episodes: Episode[], episodesDir: string): Promise<number> {
  await fs.mkdir(episodesDir, { recursive: true });

  // Group incoming episodes by YYYY-MM
  const byMonth = new Map<string, Episode[]>();
  for (const ep of episodes) {
    const key = ep.date.slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push(ep);
    byMonth.set(key, list);
  }

  let totalWritten = 0;

  for (const [yyyyMM, incoming] of byMonth) {
    const filePath = path.join(episodesDir, `${yyyyMM}.jsonl`);
    const existing = await readEpisodesFromFile(filePath);
    const existingIds = new Set(existing.map((e) => e.id));

    const toAppend = incoming.filter((ep) => !existingIds.has(ep.id));
    if (toAppend.length === 0) continue;

    // Append new lines to the file
    const newLines = toAppend.map((ep) => JSON.stringify(ep)).join("\n") + "\n";
    await fs.appendFile(filePath, newLines, "utf-8");
    totalWritten += toAppend.length;
  }

  return totalWritten;
}

/**
 * List episodes that have not yet been clustered (`clusteredInto === null`)
 * and whose `date` falls within the last `sinceDays` days (default: 60).
 *
 * Only reads monthly files that overlap with the time window.
 *
 * @param episodesDir  Directory where monthly .jsonl files live.
 * @param sinceDays    How far back to look (inclusive), in calendar days.
 */
export async function listUnclustered(episodesDir: string, sinceDays = 60): Promise<Episode[]> {
  let files: string[];
  try {
    files = await fs.readdir(episodesDir);
  } catch {
    return [];
  }

  const windowMonths = monthsInWindow(sinceDays);
  const today = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - sinceDays);

  const jsonlFiles = files
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => {
      const yyyyMM = f.slice(0, 7); // "YYYY-MM"
      return windowMonths.has(yyyyMM);
    })
    .sort();

  const result: Episode[] = [];

  for (const fileName of jsonlFiles) {
    const filePath = path.join(episodesDir, fileName);
    const episodes = await readEpisodesFromFile(filePath);

    for (const ep of episodes) {
      if (ep.clusteredInto !== null) continue;
      // Check date falls within window
      const epDate = new Date(ep.date + "T00:00:00.000Z");
      const cutoffDate = new Date(cutoff.toISOString().slice(0, 10) + "T00:00:00.000Z");
      const todayDate = new Date(today.toISOString().slice(0, 10) + "T00:00:00.000Z");
      if (epDate >= cutoffDate && epDate <= todayDate) {
        result.push(ep);
      }
    }
  }

  return result;
}

/**
 * Mark a set of episodes (by id) as clustered into a named draft skill.
 *
 * - Episodes may live in different monthly files; all relevant files are updated.
 * - Each affected file is rewritten atomically (tmp file + fs.rename).
 * - Unknown ids are silently ignored.
 *
 * @param ids        Episode ids to mark.
 * @param draftName  Name of the draft skill cluster (stored in `clusteredInto`).
 * @param episodesDir  Directory where monthly .jsonl files live.
 */
export async function markClustered(
  ids: string[],
  draftName: string,
  episodesDir: string,
): Promise<void> {
  if (ids.length === 0) return;

  const idSet = new Set(ids);

  let files: string[];
  try {
    files = await fs.readdir(episodesDir);
  } catch {
    return;
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  for (const fileName of jsonlFiles) {
    const filePath = path.join(episodesDir, fileName);
    const episodes = await readEpisodesFromFile(filePath);

    let changed = false;
    const updated = episodes.map((ep) => {
      if (idSet.has(ep.id) && ep.clusteredInto !== draftName) {
        changed = true;
        return { ...ep, clusteredInto: draftName };
      }
      return ep;
    });

    if (changed) {
      await writeEpisodesAtomic(filePath, updated);
    }
  }
}
