import { z } from "zod";
import { ConceptNodeSchema } from "./concept.ts";
import { EventNodeSchema } from "./event.ts";
import { LessonNodeSchema } from "./lesson.ts";
import { PersonNodeSchema } from "./person.ts";
import { ProjectNodeSchema } from "./project.ts";
import { SystemNodeSchema } from "./system.ts";

export * from "./base.ts";
export * from "./relations.ts";
export * from "./person.ts";
export * from "./project.ts";
export * from "./system.ts";
export * from "./concept.ts";
export * from "./event.ts";
export * from "./lesson.ts";

export const AnyNodeSchema = z.discriminatedUnion("type", [
  PersonNodeSchema,
  ProjectNodeSchema,
  SystemNodeSchema,
  ConceptNodeSchema,
  EventNodeSchema,
  LessonNodeSchema,
]);

export type AnyNode = z.infer<typeof AnyNodeSchema>;
