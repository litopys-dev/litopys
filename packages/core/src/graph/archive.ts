// Archive of tombstoned nodes.
//
// A node is "tombstoned" when its `until` field is set — it was valid up to
// that date but no longer. After enough time has passed (`olderThan` days
// past `until`) the node is dead weight in the active graph and gets moved
// to `<graphPath>/archive/`.
//
// Layout preserved: a node at `<graphPath>/systems/foo.md` lands at
// `<graphPath>/archive/systems/foo.md`. The action is recorded in
// `<graphPath>/archive/manifest.jsonl` (one JSON object per line) so the
// operation is auditable and theoretically reversible.

import { rename } from "node:fs/promises";
import * as path from "node:path";
import matter from "gray-matter";
import { AnyNodeSchema } from "../schema/index.ts";

export interface ArchivePlanItem {
  id: string;
  /** Path relative to graphPath, e.g. "systems/foo.md". */
  originalPath: string;
  /** Path relative to graphPath of the archived file, e.g. "archive/systems/foo.md". */
  archivePath: string;
  until: string;
}

export interface ArchiveManifestEntry {
  id: string;
  archived_at: string;
  original_path: string;
  until: string;
}

export interface ArchiveOptions {
  /** Reference "today" date (ISO YYYY-MM-DD). Default: actual today. */
  today?: string;
  /** Archive nodes whose `until` is at least this many days before `today`. */
  olderThan: number;
  /** If true, do not write anything; only return the plan. */
  dryRun: boolean;
}

export interface ArchiveResult {
  planned: ArchivePlanItem[];
  /** Number of files actually moved (0 when dryRun). */
  archived: number;
  /** Number of `*.md` files scanned (excluding anything under `archive/`). */
  scanned: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Return `iso - days` as an ISO YYYY-MM-DD string.
 * Pure date math, no time-zone surprises (works on UTC midnight).
 */
function subtractDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Walk the graph directory, archiving every tombstoned node whose `until`
 * is older than the cutoff. Idempotent: nodes already moved into
 * `archive/` are never re-scanned.
 */
export async function archiveTombstoned(
  graphPath: string,
  opts: ArchiveOptions,
): Promise<ArchiveResult> {
  const today = opts.today ?? todayIso();
  if (!ISO_DATE_RE.test(today)) {
    throw new Error(`today must be ISO date YYYY-MM-DD, got "${today}"`);
  }
  if (!Number.isInteger(opts.olderThan) || opts.olderThan < 0) {
    throw new Error(`olderThan must be a non-negative integer, got ${opts.olderThan}`);
  }
  const cutoff = subtractDays(today, opts.olderThan);

  const planned: ArchivePlanItem[] = [];
  let scanned = 0;

  const glob = new Bun.Glob("**/*.md");
  for await (const relPath of glob.scan({ cwd: graphPath, absolute: false })) {
    // Never re-scan files already under archive/.
    if (
      relPath === "archive" ||
      relPath.startsWith(`archive${path.sep}`) ||
      relPath.startsWith("archive/")
    ) {
      continue;
    }
    scanned++;

    const absPath = path.join(graphPath, relPath);
    let raw: string;
    try {
      raw = await Bun.file(absPath).text();
    } catch {
      continue;
    }

    let data: Record<string, unknown>;
    try {
      data = matter(raw).data as Record<string, unknown>;
    } catch {
      continue;
    }

    const parsed = AnyNodeSchema.safeParse({ ...data, body: "" });
    if (!parsed.success) continue;
    const node = parsed.data;
    if (!node.until) continue;
    if (node.until >= cutoff) continue;

    const archiveRel = path.join("archive", relPath);
    planned.push({
      id: node.id,
      originalPath: relPath,
      archivePath: archiveRel,
      until: node.until,
    });
  }

  if (opts.dryRun) {
    return { planned, archived: 0, scanned };
  }

  let archived = 0;
  const manifestPath = path.join(graphPath, "archive", "manifest.jsonl");
  const archivedAt = new Date().toISOString();

  for (const item of planned) {
    const fromAbs = path.join(graphPath, item.originalPath);
    const toAbs = path.join(graphPath, item.archivePath);
    await Bun.write(`${path.dirname(toAbs)}/.gitkeep`, "");
    await rename(fromAbs, toAbs);

    const entry: ArchiveManifestEntry = {
      id: item.id,
      archived_at: archivedAt,
      original_path: item.originalPath,
      until: item.until,
    };
    // Append-only manifest. Bun.file().writer doesn't support append, so use
    // Node-style read+write to keep things portable and simple.
    const prior = await Bun.file(manifestPath)
      .text()
      .catch(() => "");
    await Bun.write(manifestPath, `${prior}${JSON.stringify(entry)}\n`);
    archived++;
  }

  return { planned, archived, scanned };
}
