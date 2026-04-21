import { loadGraph } from "@litopys/core";
import type { CandidateNode, CandidateRelation } from "./adapters/types.ts";

export interface DedupResult {
  kept: CandidateNode[];
  dropped: CandidateNode[];
  relations: CandidateRelation[];
}

/**
 * Post-filter candidates against the existing graph.
 *
 * The extractor prompt tells the model not to re-create `existingNodeIds`,
 * but small local models (Ollama `qwen2.5:7b`, observed in the 2026-04-21
 * audit) sometimes ignore the list and emit `auto-save-project-state`,
 * `token-economy`, etc. that already exist. This is the hard safety net.
 *
 * Relations are passed through unchanged — `sourceId`/`targetId` pointing
 * at an existing node is the intended case (a new edge on an existing
 * node). Endpoint resolution happens at promote time, not here.
 *
 * If `graphPath` does not exist (e.g. first install, test sandbox), the
 * loader returns an empty node set and every candidate is kept.
 */
export async function dedupCandidatesAgainstGraph(
  candidates: CandidateNode[],
  relations: CandidateRelation[],
  graphPath: string,
): Promise<DedupResult> {
  let nodes: Awaited<ReturnType<typeof loadGraph>>["nodes"];
  try {
    const loaded = await loadGraph(graphPath);
    nodes = loaded.nodes;
  } catch {
    // Graph directory doesn't exist yet (first install, test sandbox).
    // No existing ids to dedupe against — keep every candidate.
    return { kept: [...candidates], dropped: [], relations };
  }

  const existingIds = new Set<string>();
  for (const node of nodes.values()) {
    existingIds.add(node.id.toLowerCase());
    for (const alias of node.aliases ?? []) {
      existingIds.add(alias.toLowerCase());
    }
  }

  const kept: CandidateNode[] = [];
  const dropped: CandidateNode[] = [];
  for (const candidate of candidates) {
    if (existingIds.has(candidate.id.toLowerCase())) {
      dropped.push(candidate);
    } else {
      kept.push(candidate);
    }
  }

  return { kept, dropped, relations };
}
