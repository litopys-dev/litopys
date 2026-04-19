import matter from "gray-matter";
import { type AnyNode, AnyNodeSchema } from "../schema/index.ts";

export interface GraphError {
  kind:
    | "parse"
    | "validation"
    | "duplicate_id"
    | "unknown_relation"
    | "broken_ref"
    | "wrong_relation_type";
  file: string;
  id?: string;
  message: string;
}

export interface LoadResult {
  nodes: Map<string, AnyNode>;
  errors: GraphError[];
}

export async function loadGraph(dir: string): Promise<LoadResult> {
  const nodes = new Map<string, AnyNode>();
  const errors: GraphError[] = [];

  const glob = new Bun.Glob("**/*.md");
  const files: string[] = [];

  for await (const file of glob.scan({ cwd: dir, absolute: false })) {
    files.push(file);
  }

  for (const relPath of files) {
    const absPath = `${dir}/${relPath}`;
    let raw: string;

    try {
      raw = await Bun.file(absPath).text();
    } catch (err) {
      errors.push({
        kind: "parse",
        file: relPath,
        message: `Failed to read file: ${String(err)}`,
      });
      continue;
    }

    let data: Record<string, unknown>;
    let content: string;

    try {
      const parsed = matter(raw);
      data = parsed.data as Record<string, unknown>;
      content = parsed.content.trim();
    } catch (err) {
      errors.push({
        kind: "parse",
        file: relPath,
        message: `Failed to parse frontmatter: ${String(err)}`,
      });
      continue;
    }

    const result = AnyNodeSchema.safeParse({ ...data, body: content });

    if (!result.success) {
      errors.push({
        kind: "validation",
        file: relPath,
        id: typeof data.id === "string" ? data.id : undefined,
        message: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
      });
      continue;
    }

    const node = result.data;

    if (nodes.has(node.id)) {
      errors.push({
        kind: "duplicate_id",
        file: relPath,
        id: node.id,
        message: `Duplicate node id: "${node.id}"`,
      });
      continue;
    }

    nodes.set(node.id, node);
  }

  return { nodes, errors };
}
