/**
 * `litopys propose-merge <a> <b>` — generate a merge-proposal quarantine file.
 * Never auto-applies. Explicit `litopys quarantine accept <file>` applies.
 */

import * as path from "node:path";
import { loadGraph, scoreSimilarity } from "@litopys/core";
import { proposeMerge, writeMergeProposal } from "@litopys/extractor";

export async function cmdProposeMerge(args: string[], graphDir: string): Promise<void> {
  if (args.length < 2) {
    process.stderr.write("Usage: propose-merge <id-a> <id-b>\n");
    process.exit(1);
  }
  const [idA, idB] = args as [string, string];

  const graph = await loadGraph(graphDir);
  const a = graph.nodes.get(idA);
  const b = graph.nodes.get(idB);
  if (!a) {
    process.stderr.write(`Node not found: "${idA}"\n`);
    process.exit(1);
  }
  if (!b) {
    process.stderr.write(`Node not found: "${idB}"\n`);
    process.exit(1);
  }

  const similarity = scoreSimilarity(a, b);
  const proposal = proposeMerge(a, b, {
    detectedBy: `similar:${similarity.score.toFixed(3)}`,
  });

  const qDir = path.join(graphDir, "..", "quarantine");
  const filePath = await writeMergeProposal(proposal, qDir);

  process.stdout.write(`Merge proposal written: ${filePath}\n`);
  process.stdout.write(`  winner: ${proposal.result.winnerId}\n`);
  process.stdout.write(`  loser:  ${proposal.result.loserId}\n`);
  process.stdout.write(`  similarity score: ${similarity.score.toFixed(3)}\n`);
  process.stdout.write(`  conflicts: ${proposal.conflicts.length}\n`);
  for (const c of proposal.conflicts) {
    process.stdout.write(`    · [${c.field}] ${c.detail}\n`);
  }
  process.stdout.write("\nReview then:\n");
  process.stdout.write(`  litopys quarantine accept ${filePath}\n`);
  process.stdout.write(`  litopys quarantine reject ${filePath}\n`);
}
