import { z } from "zod";
import { BaseNodeSchema } from "./base.ts";

export const PersonNodeSchema = BaseNodeSchema.extend({
  type: z.literal("person"),
});

export type PersonNode = z.infer<typeof PersonNodeSchema>;
