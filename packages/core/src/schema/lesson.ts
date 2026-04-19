import { z } from "zod";
import { BaseNodeSchema } from "./base.ts";

export const LessonNodeSchema = BaseNodeSchema.extend({
  type: z.literal("lesson"),
});

export type LessonNode = z.infer<typeof LessonNodeSchema>;
