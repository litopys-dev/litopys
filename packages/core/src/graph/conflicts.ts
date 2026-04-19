import type { AnyNode } from "../schema/index.ts";
import type { ResolvedGraph } from "./resolver.ts";

export interface Conflict {
  kind: "logical" | "duplicate_alias" | "stale";
  nodes: string[];
  message: string;
}

const POSITIVE_RELATIONS = new Set(["uses", "depends_on", "reinforces"]);
const STALE_MONTHS = 6;

function monthsDiff(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export function detectConflicts(graph: ResolvedGraph): Conflict[] {
  const conflicts: Conflict[] = [];
  const mockNow = Bun.env.MOCK_NOW;
  const now = mockNow ? new Date(mockNow) : new Date();

  // 1. Logical: A conflicts_with B AND A uses/depends_on/reinforces B
  const conflictPairs = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.relation === "conflicts_with") {
      const key = [edge.from, edge.to].sort().join("|");
      conflictPairs.add(key);
    }
  }

  for (const edge of graph.edges) {
    if (POSITIVE_RELATIONS.has(edge.relation)) {
      const key = [edge.from, edge.to].sort().join("|");
      if (conflictPairs.has(key)) {
        conflicts.push({
          kind: "logical",
          nodes: [edge.from, edge.to],
          message: `Node "${edge.from}" both conflicts_with and ${edge.relation} "${edge.to}"`,
        });
      }
    }
  }

  // 2. Duplicate aliases
  const aliasMap = new Map<string, string[]>();
  for (const [, node] of graph.nodes) {
    if (!node.aliases) continue;
    for (const alias of node.aliases) {
      const lower = alias.toLowerCase();
      if (!aliasMap.has(lower)) aliasMap.set(lower, []);
      aliasMap.get(lower)?.push(node.id);
    }
  }
  for (const [alias, ids] of aliasMap) {
    if (ids.length > 1) {
      conflicts.push({
        kind: "duplicate_alias",
        nodes: ids,
        message: `Alias "${alias}" is shared by nodes: ${ids.join(", ")}`,
      });
    }
  }

  // 3. Stale: updated > 6 months ago
  for (const [, node] of graph.nodes) {
    const updated = new Date(node.updated);
    if (monthsDiff(updated, now) > STALE_MONTHS) {
      conflicts.push({
        kind: "stale",
        nodes: [node.id],
        message: `Node "${node.id}" was last updated on ${node.updated}, which is more than ${STALE_MONTHS} months ago`,
      });
    }
  }

  return conflicts;
}
