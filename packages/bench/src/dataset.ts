import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const BenchMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
});

export const BenchSessionSchema = z.object({
  id: z.string().min(1),
  messages: z.array(BenchMessageSchema).min(1),
});

export const BenchQuestionSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  expected_node_ids: z.array(z.string().min(1)).min(1),
});

export const BenchDatasetSchema = z.object({
  name: z.string().min(1).optional(),
  sessions: z.array(BenchSessionSchema).min(1),
  questions: z.array(BenchQuestionSchema).min(1),
});

export type BenchMessage = z.infer<typeof BenchMessageSchema>;
export type BenchSession = z.infer<typeof BenchSessionSchema>;
export type BenchQuestion = z.infer<typeof BenchQuestionSchema>;
export type BenchDataset = z.infer<typeof BenchDatasetSchema>;

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** Parse JSON string into a validated BenchDataset. Throws on schema errors. */
export function parseDataset(json: string, fallbackName?: string): BenchDataset {
  const raw = JSON.parse(json) as unknown;
  const parsed = BenchDatasetSchema.parse(raw);
  if (!parsed.name && fallbackName) {
    return { ...parsed, name: fallbackName };
  }
  return parsed;
}

/** Read and parse a dataset file from disk. */
export async function loadDatasetFile(filePath: string): Promise<BenchDataset> {
  const text = await fs.readFile(filePath, "utf-8");
  const base = path.basename(filePath, path.extname(filePath));
  return parseDataset(text, base);
}

// ---------------------------------------------------------------------------
// Built-in dataset registry
// ---------------------------------------------------------------------------

/** Absolute path to a built-in fixture (resolved relative to this file). */
export function builtinDatasetPath(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "fixtures", `${name}.json`);
}

export const BUILTIN_DATASETS = ["synthetic"] as const;
export type BuiltinDataset = (typeof BUILTIN_DATASETS)[number];

export function isBuiltinDataset(name: string): name is BuiltinDataset {
  return (BUILTIN_DATASETS as readonly string[]).includes(name);
}

/**
 * Resolve a dataset spec to a file path:
 * - bare names like "synthetic" -> bundled fixture
 * - anything containing "/" or ending in .json -> treated as filesystem path
 */
export function resolveDatasetSpec(spec: string): string {
  if (isBuiltinDataset(spec)) return builtinDatasetPath(spec);
  return path.resolve(spec);
}

export async function loadDataset(spec: string): Promise<BenchDataset> {
  return loadDatasetFile(resolveDatasetSpec(spec));
}
