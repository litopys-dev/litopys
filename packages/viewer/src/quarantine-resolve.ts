// ---------------------------------------------------------------------------
// Quarantine relation resolution
//
// Relations in a quarantine file reference node ids that may be (a) candidates
// born in the same file, (b) nodes already living in the graph, or (c) dangling
// references to neither. The dashboard needs that context to render a relation
// as a human-readable sentence instead of two opaque ids. This module resolves
// each id into { origin, type?, summary? } using only in-memory lookups.
//
// Kept decoupled from concrete node/candidate classes via the minimal RefSource
// shape so it stays trivially unit-testable.
// ---------------------------------------------------------------------------

import type { NodeType, RelationName } from "@litopys/core";

export type RefOrigin = "new" | "existing" | "unknown";

/** Minimal shape we read off a candidate or graph node. */
export interface RefSource {
  type: NodeType;
  summary?: string;
}

export interface ResolvedRef {
  id: string;
  origin: RefOrigin;
  type?: NodeType;
  summary?: string;
}

export interface RawRelation {
  type: RelationName;
  sourceId: string;
  targetId: string;
  confidence?: number;
  reasoning?: string;
}

export interface ResolvedQuarantineRelation {
  type: RelationName;
  source: ResolvedRef;
  target: ResolvedRef;
  confidence?: number;
  reasoning?: string;
}

/**
 * Resolve a single id. Candidates take precedence over graph nodes: an id that
 * is being created in this very file is "new" even if a node with the same id
 * somehow already exists (the candidate is what the reviewer is judging).
 */
export function resolveRef(
  id: string,
  candidates: ReadonlyMap<string, RefSource>,
  graphNodes: ReadonlyMap<string, RefSource>,
): ResolvedRef {
  const cand = candidates.get(id);
  if (cand) return { id, origin: "new", type: cand.type, summary: cand.summary };
  const node = graphNodes.get(id);
  if (node) return { id, origin: "existing", type: node.type, summary: node.summary };
  return { id, origin: "unknown" };
}

export function resolveRelation(
  rel: RawRelation,
  candidates: ReadonlyMap<string, RefSource>,
  graphNodes: ReadonlyMap<string, RefSource>,
): ResolvedQuarantineRelation {
  return {
    type: rel.type,
    source: resolveRef(rel.sourceId, candidates, graphNodes),
    target: resolveRef(rel.targetId, candidates, graphNodes),
    confidence: rel.confidence,
    reasoning: rel.reasoning,
  };
}
