import { z } from "zod";
import { BaseNodeSchema } from "./base.ts";

export const SystemNodeSchema = BaseNodeSchema.extend({
  type: z.literal("system"),
});

export type SystemNode = z.infer<typeof SystemNodeSchema>;
