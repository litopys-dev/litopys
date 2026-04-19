import { type AnyNode, RELATION_CONSTRAINTS, RelationName } from "../schema/index.ts";
import type { GraphError, LoadResult } from "./loader.ts";

export interface Edge {
  from: string;
  to: string;
  relation: RelationName;
  symmetric: boolean;
}

export interface ResolvedGraph {
  nodes: Map<string, AnyNode>;
  edges: Edge[];
  errors: GraphError[];
}

export function resolveGraph(load: LoadResult): ResolvedGraph {
  const edges: Edge[] = [];
  const errors: GraphError[] = [...load.errors];

  for (const [, node] of load.nodes) {
    if (!node.rels) continue;

    for (const [relRaw, targets] of Object.entries(node.rels)) {
      const relParsed = RelationName.safeParse(relRaw);
      if (!relParsed.success) {
        errors.push({
          kind: "unknown_relation",
          file: "",
          id: node.id,
          message: `Unknown relation "${relRaw}" on node "${node.id}"`,
        });
        continue;
      }

      const rel = relParsed.data;
      const constraint = RELATION_CONSTRAINTS[rel];

      // Check source type is allowed
      if (!constraint.sources.includes(node.type)) {
        errors.push({
          kind: "wrong_relation_type",
          file: "",
          id: node.id,
          message: `Relation "${rel}" cannot have source type "${node.type}" (allowed: ${constraint.sources.join(", ")})`,
        });
        continue;
      }

      for (const targetId of targets) {
        const targetNode = load.nodes.get(targetId);

        if (!targetNode) {
          errors.push({
            kind: "broken_ref",
            file: "",
            id: node.id,
            message: `Node "${node.id}" has relation "${rel}" pointing to unknown id "${targetId}"`,
          });
          continue;
        }

        // Check target type is allowed
        if (!constraint.targets.includes(targetNode.type)) {
          errors.push({
            kind: "wrong_relation_type",
            file: "",
            id: node.id,
            message: `Relation "${rel}" cannot have target type "${targetNode.type}" for source "${node.id}" (allowed: ${constraint.targets.join(", ")})`,
          });
          continue;
        }

        edges.push({ from: node.id, to: targetId, relation: rel, symmetric: constraint.symmetric });

        // For symmetric relations, add reverse edge
        if (constraint.symmetric) {
          // Only add reverse if not already added
          const reverseExists = edges.some(
            (e) => e.from === targetId && e.to === node.id && e.relation === rel,
          );
          if (!reverseExists) {
            edges.push({ from: targetId, to: node.id, relation: rel, symmetric: true });
          }
        }
      }
    }
  }

  return { nodes: load.nodes, edges, errors };
}
