/**
 * Auto-apply high-confidence merge proposals.
 *
 * Walks the quarantine directory for merge-proposal files (`isMergeProposalContent`),
 * parses each proposal's `detectedBy` provenance to extract its similarity score
 * (format `"similar:0.873"` as emitted by `litopys propose-merge`), and calls
 * `acceptMergeProposal()` for every proposal whose score is at least
 * `minSimilarity`.
 *
 * Conservative by design:
 *   - Anything without a parseable `similar:<score>` is skipped, never accepted.
 *   - Manual proposals (`detectedBy: "manual"`) require human review.
 *   - Errors from `acceptMergeProposal` (e.g. type-conflict, missing node)
 *     are captured per-file; one failure does not abort the run.
 *
 * `dryRun: true` returns the same plan but performs no graph mutation.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { acceptMergeProposal } from "./merge-apply.ts";
import { isMergeProposalContent, parseMergeProposal } from "./merge-proposal.ts";

export interface AutoMergeOptions {
  quarantineDir: string;
  graphPath: string;
  /** Inclusive lower bound on similarity score. 0..1. */
  minSimilarity: number;
  dryRun: boolean;
}

export interface AutoMergedItem {
  proposalPath: string;
  winnerId: string;
  loserId: string;
  similarity: number;
  /** Number of conflicts noted on the proposal but not blocking acceptance. */
  conflictsIgnored: number;
}

export interface AutoMergeSkip {
  proposalPath: string;
  reason: "below-threshold" | "missing-similarity" | "not-a-merge-proposal";
  similarity?: number;
}

export interface AutoMergeError {
  proposalPath: string;
  message: string;
}

export interface AutoMergeResult {
  /** Merge-proposal files actually accepted (or planned for, when dryRun). */
  merged: AutoMergedItem[];
  /** Proposals scanned but not accepted (with reason). */
  skipped: AutoMergeSkip[];
  /** Acceptance attempts that threw. */
  errors: AutoMergeError[];
  /** Number of merge-proposal files inspected (includes merged, skipped, errors). */
  scanned: number;
}

const SIMILARITY_RE = /^similar:([0-1](?:\.\d+)?|\.\d+)$/;

export function parseSimilarity(detectedBy: string): number | undefined {
  const m = detectedBy.match(SIMILARITY_RE);
  if (!m?.[1]) return undefined;
  const f = Number.parseFloat(m[1]);
  if (!Number.isFinite(f) || f < 0 || f > 1) return undefined;
  return f;
}

export async function autoMergeProposals(opts: AutoMergeOptions): Promise<AutoMergeResult> {
  if (!Number.isFinite(opts.minSimilarity) || opts.minSimilarity < 0 || opts.minSimilarity > 1) {
    throw new Error(`minSimilarity must be 0..1, got ${opts.minSimilarity}`);
  }

  const merged: AutoMergedItem[] = [];
  const skipped: AutoMergeSkip[] = [];
  const errors: AutoMergeError[] = [];
  let scanned = 0;

  let entries: string[];
  try {
    entries = await fs.readdir(opts.quarantineDir);
  } catch {
    return { merged, skipped, errors, scanned };
  }

  // Stable order keeps test output deterministic and gives operators a
  // predictable apply sequence when two proposals touch the same node.
  entries.sort();

  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const filePath = path.join(opts.quarantineDir, name);

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    if (!isMergeProposalContent(content)) continue;
    scanned++;

    let proposal: ReturnType<typeof parseMergeProposal>;
    try {
      proposal = parseMergeProposal(content);
    } catch (err) {
      errors.push({ proposalPath: filePath, message: String(err) });
      continue;
    }

    const similarity = parseSimilarity(proposal.detectedBy);
    if (similarity === undefined) {
      skipped.push({ proposalPath: filePath, reason: "missing-similarity" });
      continue;
    }
    if (similarity < opts.minSimilarity) {
      skipped.push({ proposalPath: filePath, reason: "below-threshold", similarity });
      continue;
    }

    if (opts.dryRun) {
      merged.push({
        proposalPath: filePath,
        winnerId: proposal.result.winnerId,
        loserId: proposal.result.loserId,
        similarity,
        conflictsIgnored: proposal.conflicts.length,
      });
      continue;
    }

    try {
      const result = await acceptMergeProposal(filePath, opts.graphPath);
      merged.push({
        proposalPath: filePath,
        winnerId: result.winnerId,
        loserId: result.loserId,
        similarity,
        conflictsIgnored: result.conflictsIgnored,
      });
    } catch (err) {
      errors.push({ proposalPath: filePath, message: String(err) });
    }
  }

  return { merged, skipped, errors, scanned };
}
