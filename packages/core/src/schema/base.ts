import { z } from "zod";

export const NodeType = z.enum(["person", "project", "system", "concept", "event", "lesson"]);
export type NodeType = z.infer<typeof NodeType>;

export const RelationName = z.enum([
  "owns",
  "prefers",
  "learned_from",
  "uses",
  "applies_to",
  "conflicts_with",
  "runs_on",
  "depends_on",
  "reinforces",
  "mentioned_in",
  "supersedes",
]);
export type RelationName = z.infer<typeof RelationName>;

// Bi-temporal model:
//   updated      — document time: when this node was last recorded.
//   occurred_at  — event time: when the underlying fact/event actually took place.
//                  Optional; fallback to `updated` (or to date prefix of id for events).
//   since/until  — validity interval in event-time. A node is "valid as-of D" when
//                  (since === undefined || since <= D) AND (until === undefined || until > D).
export const BaseNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be lowercase kebab-case"),
  type: NodeType,
  aliases: z.array(z.string()).optional(),
  summary: z.string().max(200).optional(),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "updated must be ISO date YYYY-MM-DD"),
  confidence: z.number().min(0).max(1),
  occurred_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "occurred_at must be ISO date YYYY-MM-DD")
    .optional(),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "since must be ISO date YYYY-MM-DD")
    .optional(),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "until must be ISO date YYYY-MM-DD")
    .optional(),
  rels: z.record(RelationName, z.array(z.string())).optional(),
  tags: z.array(z.string()).optional(),
  body: z.string().optional(),
});

export type BaseNode = z.infer<typeof BaseNodeSchema>;
