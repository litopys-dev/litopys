import { z } from "zod";
import { BaseNodeSchema } from "./base.ts";

export const ProjectNodeSchema = BaseNodeSchema.extend({
  type: z.literal("project"),
});

export type ProjectNode = z.infer<typeof ProjectNodeSchema>;
