/**
 * Merge proposals — deterministic "A + B → merged" preview.
 *
 * Never applied automatically. Goes into the same quarantine directory as
 * extractor candidates, gets an explicit review via `litopys quarantine accept`.
 *
 * On accept:
 *   1. a merged node is written (inherits the "winner" id, union of aliases,
 *      tags, rels; divergent summary/body keep the winner's value)
 *   2. the loser node keeps its file but gets `until: <today>` (tombstoned)
 *   3. a `supersedes: [loser]` relation is added to the winner
 *
 * Applying is conservative on purpose: external refs to the loser stay valid
 * but are explicitly marked as pointing to a superseded node.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { AnyNode, RelationName } from "@litopys/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeConflict {
  field: "summary" | "body" | "type" | "rels";
  /** Short human-readable detail. */
  detail: string;
}

export interface MergeResult {
  id: string;
  type: AnyNode["type"];
  aliases: string[];
  summary?: string;
  tags: string[];
  rels: Partial<Record<RelationName, string[]>>;
  body?: string;
  confidence: number;
  /** winner id, loser id */
  winnerId: string;
  loserId: string;
}

export interface MergeProposal {
  kind: "merge-proposal";
  sourceA: string;
  sourceB: string;
  result: MergeResult;
  conflicts: MergeConflict[];
  detectedBy: string;
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

export interface ProposeMergeOptions {
  /** Free-form provenance string, e.g. "similar:0.87". */
  detectedBy?: string;
}

/** Build a merge proposal from two nodes. Caller has already decided they match. */
export function proposeMerge(
  a: AnyNode,
  b: AnyNode,
  opts: ProposeMergeOptions = {},
): MergeProposal {
  const conflicts: MergeConflict[] = [];

  // Type conflict is critical — proposal still generated but flagged.
  if (a.type !== b.type) {
    conflicts.push({
      field: "type",
      detail: `types differ: ${a.type} (${a.id}) vs ${b.type} (${b.id})`,
    });
  }

  // Pick winner: higher confidence, tie-break by earlier updated date, then by id order
  const winner = pickWinner(a, b);
  const loser = winner.id === a.id ? b : a;

  const aliases = mergeAliases(winner, loser);
  const tags = Array.from(new Set([...(winner.tags ?? []), ...(loser.tags ?? [])]));
  const { rels, relConflicts } = mergeRels(winner, loser);
  conflicts.push(...relConflicts);

  let summary = winner.summary;
  if (winner.summary && loser.summary && winner.summary.trim() !== loser.summary.trim()) {
    conflicts.push({
      field: "summary",
      detail: `keeping winner "${truncate(winner.summary, 60)}"; loser had "${truncate(
        loser.summary,
        60,
      )}"`,
    });
  } else if (!winner.summary && loser.summary) {
    summary = loser.summary;
  }

  let body = winner.body;
  if (winner.body && loser.body && winner.body.trim() !== loser.body.trim()) {
    conflicts.push({
      field: "body",
      detail: "body content differs between winner and loser; keeping winner",
    });
  } else if (!winner.body && loser.body) {
    body = loser.body;
  }

  const result: MergeResult = {
    id: winner.id,
    type: winner.type,
    aliases,
    summary,
    tags,
    rels,
    body,
    confidence: Math.min(winner.confidence ?? 1, loser.confidence ?? 1),
    winnerId: winner.id,
    loserId: loser.id,
  };

  return {
    kind: "merge-proposal",
    sourceA: a.id,
    sourceB: b.id,
    result,
    conflicts,
    detectedBy: opts.detectedBy ?? "manual",
  };
}

// ---------------------------------------------------------------------------
// Serialize / deserialize
// ---------------------------------------------------------------------------

/**
 * Write a merge proposal as a quarantine file.
 * Returns the path to the written file.
 */
export async function writeMergeProposal(proposal: MergeProposal, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const safeName = `${proposal.sourceA}+${proposal.sourceB}`
    .replace(/[^a-z0-9+-]/gi, "-")
    .slice(0, 80);
  const fileName = `merge-${timestamp.replace(/:/g, "-")}-${safeName}.md`;
  const filePath = path.join(dir, fileName);

  const content = serializeMergeProposal(proposal, timestamp);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

export function serializeMergeProposal(proposal: MergeProposal, timestamp: string): string {
  const fm: Record<string, unknown> = {
    kind: proposal.kind,
    sourceA: proposal.sourceA,
    sourceB: proposal.sourceB,
    timestamp,
    detectedBy: proposal.detectedBy,
    conflictCount: proposal.conflicts.length,
  };

  const lines: string[] = [];
  lines.push("---");
  for (const [k, v] of Object.entries(fm)) {
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# Merge Proposal: ${proposal.sourceA} + ${proposal.sourceB}`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify({ result: proposal.result, conflicts: proposal.conflicts }, null, 2));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export function parseMergeProposal(content: string): MergeProposal {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch?.[1]) throw new Error("Invalid merge-proposal file: missing frontmatter");

  const fm: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 2);
    try {
      const parsed = JSON.parse(val) as unknown;
      if (typeof parsed === "string") fm[key] = parsed;
    } catch {
      // non-JSON values ignored
    }
  }

  if (fm.kind !== "merge-proposal") {
    throw new Error(`Not a merge-proposal file (kind=${fm.kind ?? "<missing>"})`);
  }
  if (!fm.sourceA || !fm.sourceB) {
    throw new Error("merge-proposal missing sourceA/sourceB");
  }

  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch?.[1]) throw new Error("merge-proposal missing body JSON");
  const body = JSON.parse(jsonMatch[1]) as { result: MergeResult; conflicts: MergeConflict[] };

  return {
    kind: "merge-proposal",
    sourceA: fm.sourceA,
    sourceB: fm.sourceB,
    result: body.result,
    conflicts: body.conflicts ?? [],
    detectedBy: fm.detectedBy ?? "unknown",
  };
}

/** Cheap sniff — does this content look like a merge-proposal? (Does not parse.) */
export function isMergeProposalContent(content: string): boolean {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  return fmMatch?.[1]?.includes('"merge-proposal"') ?? false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pickWinner(a: AnyNode, b: AnyNode): AnyNode {
  const aConf = a.confidence ?? 0;
  const bConf = b.confidence ?? 0;
  if (aConf !== bConf) return aConf > bConf ? a : b;
  if (a.updated !== b.updated) return a.updated > b.updated ? a : b;
  return a.id <= b.id ? a : b;
}

function mergeAliases(winner: AnyNode, loser: AnyNode): string[] {
  const set = new Set<string>();
  for (const alias of winner.aliases ?? []) set.add(alias);
  for (const alias of loser.aliases ?? []) set.add(alias);
  // The loser's id and summary become aliases so searches still find them
  set.add(loser.id);
  if (loser.summary) set.add(loser.summary);
  set.delete(winner.id);
  return Array.from(set).sort();
}

function mergeRels(
  winner: AnyNode,
  loser: AnyNode,
): { rels: Partial<Record<RelationName, string[]>>; relConflicts: MergeConflict[] } {
  const rels: Partial<Record<RelationName, string[]>> = {};
  for (const [rel, targets] of Object.entries(winner.rels ?? {})) {
    rels[rel as RelationName] = [...(targets ?? [])];
  }
  for (const [rel, targets] of Object.entries(loser.rels ?? {})) {
    const key = rel as RelationName;
    const merged = new Set(rels[key] ?? []);
    for (const t of targets ?? []) merged.add(t);
    rels[key] = Array.from(merged).sort();
  }

  // Mark loser as superseded by winner
  const supersedes = new Set(rels.supersedes ?? []);
  supersedes.add(loser.id);
  rels.supersedes = Array.from(supersedes).sort();

  // Logical conflict: if winner and loser each declared the other via
  // a non-overlapping relation list, that's worth flagging.
  const relConflicts: MergeConflict[] = [];
  const winnerTargets = new Set(Object.values(winner.rels ?? {}).flatMap((arr) => arr ?? []));
  const loserTargets = new Set(Object.values(loser.rels ?? {}).flatMap((arr) => arr ?? []));
  if (winnerTargets.has(loser.id) || loserTargets.has(winner.id)) {
    relConflicts.push({
      field: "rels",
      detail: `existing direct relation between ${winner.id} and ${loser.id} — review manually`,
    });
  }

  return { rels, relConflicts };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
