/**
 * Apply a merge proposal to the graph.
 *
 * Three conservative steps:
 *   1. Write the merged node to the winner's file (overwrite)
 *   2. Add `until: <today>` to the loser (tombstone; node file stays so external
 *      references keep resolving)
 *   3. The `supersedes: [loserId]` relation is already baked into the merged
 *      node's rels by proposeMerge() — nothing extra here.
 *
 * Reject = discard the proposal file, no graph mutation.
 */

import { promises as fs } from "node:fs";
import { loadGraph, writeNode } from "@litopys/core";
import type { AnyNode, RelationName } from "@litopys/core";
import { isMergeProposalContent, parseMergeProposal } from "./merge-proposal.ts";

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

export interface AcceptMergeResult {
  winnerId: string;
  loserId: string;
  conflictsIgnored: number;
}

export async function acceptMergeProposal(
  proposalFilePath: string,
  graphPath: string,
): Promise<AcceptMergeResult> {
  const content = await fs.readFile(proposalFilePath, "utf-8");
  if (!isMergeProposalContent(content)) {
    throw new Error(`Not a merge-proposal file: ${proposalFilePath}`);
  }
  const proposal = parseMergeProposal(content);

  // Critical block: if types differ we refuse to apply automatically.
  const typeConflict = proposal.conflicts.find((c) => c.field === "type");
  if (typeConflict) {
    throw new Error(
      `Cannot auto-apply merge with type conflict: ${typeConflict.detail}. Resolve manually by editing one of the nodes to match types, then re-propose.`,
    );
  }

  const loaded = await loadGraph(graphPath);
  const winner = loaded.nodes.get(proposal.result.winnerId);
  const loser = loaded.nodes.get(proposal.result.loserId);
  if (!winner) {
    throw new Error(`Winner node "${proposal.result.winnerId}" no longer in graph`);
  }
  if (!loser) {
    throw new Error(`Loser node "${proposal.result.loserId}" no longer in graph`);
  }

  // Build the merged node — reuse winner as template for required fields we
  // don't carry in the proposal (since, until).
  const today = new Date().toISOString().slice(0, 10);
  const merged: AnyNode = {
    ...winner,
    id: proposal.result.id,
    type: proposal.result.type,
    aliases: proposal.result.aliases.length > 0 ? proposal.result.aliases : undefined,
    summary: proposal.result.summary,
    tags: proposal.result.tags.length > 0 ? proposal.result.tags : undefined,
    rels: normalizeRels(proposal.result.rels),
    body: proposal.result.body,
    confidence: proposal.result.confidence,
    updated: today,
  } as AnyNode;
  await writeNode(graphPath, merged);

  // Tombstone the loser
  const tombstoned: AnyNode = { ...loser, until: today, updated: today } as AnyNode;
  await writeNode(graphPath, tombstoned);

  // Archive the proposal file — move it out of active quarantine to ./archive/
  await archiveProposalFile(proposalFilePath);

  return {
    winnerId: merged.id,
    loserId: loser.id,
    conflictsIgnored: proposal.conflicts.length,
  };
}

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------

export async function rejectMergeProposal(proposalFilePath: string): Promise<void> {
  const content = await fs.readFile(proposalFilePath, "utf-8");
  if (!isMergeProposalContent(content)) {
    throw new Error(`Not a merge-proposal file: ${proposalFilePath}`);
  }
  await archiveProposalFile(proposalFilePath, "rejected");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function archiveProposalFile(filePath: string, suffix = "accepted"): Promise<void> {
  const dir = filePath.replace(/\/[^/]+$/, "");
  const archiveDir = `${dir}/archive`;
  await fs.mkdir(archiveDir, { recursive: true });
  const base = filePath.replace(/^.*\//, "");
  const dest = `${archiveDir}/${suffix}-${base}`;
  await fs.rename(filePath, dest);
}

function normalizeRels(
  rels: Partial<Record<RelationName, string[]>>,
): Partial<Record<RelationName, string[]>> | undefined {
  const out: Partial<Record<RelationName, string[]>> = {};
  let hasAny = false;
  for (const [rel, list] of Object.entries(rels)) {
    if (list && list.length > 0) {
      out[rel as RelationName] = [...list];
      hasAny = true;
    }
  }
  return hasAny ? out : undefined;
}
