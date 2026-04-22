import { rename } from "node:fs/promises";
import matter from "gray-matter";
import type { AnyNode } from "../schema/index.ts";

const TYPE_DIR: Record<string, string> = {
  person: "people",
  project: "projects",
  system: "systems",
  concept: "concepts",
  event: "events",
  lesson: "lessons",
};

export function normalizeId(id: string): string {
  return id
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as T;
}

export async function writeNode(dir: string, node: AnyNode): Promise<void> {
  const typeDir = TYPE_DIR[node.type];
  const outDir = `${dir}/${typeDir}`;

  // Create directory if not exists
  await Bun.write(`${outDir}/.gitkeep`, "");

  const { body, ...frontmatter } = stripUndefined(node);
  const normalizedId = normalizeId(node.id);
  const serialized = matter.stringify(typeof body === "string" ? body : "", frontmatter);
  const outPath = `${outDir}/${normalizedId}.md`;
  // Atomic write: stage to a temp file in the same directory, then rename over target.
  // rename(2) is atomic within one filesystem — readers never observe a half-written file.
  const tmpPath = `${outPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;

  await Bun.write(tmpPath, serialized);
  await rename(tmpPath, outPath);
}
