import { z } from "zod";
import { BaseNodeSchema } from "./base.ts";

export const ConceptNodeSchema = BaseNodeSchema.extend({
  type: z.literal("concept"),
});

export type ConceptNode = z.infer<typeof ConceptNodeSchema>;
