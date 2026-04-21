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

export const BaseNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be lowercase kebab-case"),
  type: NodeType,
  aliases: z.array(z.string()).optional(),
  summary: z.string().max(200).optional(),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "updated must be ISO date YYYY-MM-DD"),
  confidence: z.number().min(0).max(1),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  rels: z.record(RelationName, z.array(z.string())).optional(),
  tags: z.array(z.string()).optional(),
  body: z.string().optional(),
});

export type BaseNode = z.infer<typeof BaseNodeSchema>;
