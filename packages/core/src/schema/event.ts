import { z } from "zod";
import { BaseNodeSchema } from "./base.ts";

export const EventNodeSchema = BaseNodeSchema.extend({
  type: z.literal("event"),
});

export type EventNode = z.infer<typeof EventNodeSchema>;
