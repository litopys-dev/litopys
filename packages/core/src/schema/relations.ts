import type { NodeType, RelationName } from "./base.ts";

export interface RelationConstraint {
  sources: NodeType[];
  targets: NodeType[];
  symmetric: boolean;
}

const ALL_TYPES: NodeType[] = ["person", "project", "system", "concept", "event", "lesson"];

export const RELATION_CONSTRAINTS: Record<RelationName, RelationConstraint> = {
  owns: {
    sources: ["person"],
    targets: ["project", "system"],
    symmetric: false,
  },
  prefers: {
    sources: ["person"],
    targets: ["concept"],
    symmetric: false,
  },
  learned_from: {
    sources: ["person"],
    targets: ["lesson", "event"],
    symmetric: false,
  },
  uses: {
    sources: ["person", "project", "system"],
    targets: ["system", "project"],
    symmetric: false,
  },
  applies_to: {
    sources: ["concept", "lesson"],
    targets: ["project", "system", "concept"],
    symmetric: false,
  },
  conflicts_with: {
    sources: ALL_TYPES,
    targets: ALL_TYPES,
    symmetric: true,
  },
  runs_on: {
    sources: ["project", "system"],
    targets: ["system"],
    symmetric: false,
  },
  depends_on: {
    sources: ["project", "system"],
    targets: ["project", "system"],
    symmetric: false,
  },
  reinforces: {
    sources: ["event", "lesson"],
    targets: ["concept"],
    symmetric: false,
  },
  mentioned_in: {
    sources: ALL_TYPES,
    targets: ["event"],
    symmetric: false,
  },
};
