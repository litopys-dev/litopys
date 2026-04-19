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

export async function writeNode(dir: string, node: AnyNode): Promise<void> {
  const typeDir = TYPE_DIR[node.type];
  const outDir = `${dir}/${typeDir}`;

  // Create directory if not exists
  await Bun.write(`${outDir}/.gitkeep`, "");

  const { body, ...frontmatter } = node;
  const normalizedId = normalizeId(node.id);
  const serialized = matter.stringify(body ?? "", frontmatter);
  const outPath = `${outDir}/${normalizedId}.md`;

  await Bun.write(outPath, serialized);
}
