import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { glob } from "node:fs/promises";
import * as path from "node:path";
import type { SourceAdapter, TranscriptChunk } from "./types.ts";

/**
 * TextAdapter — reads a plain-text file as-is.
 *
 * Spec format: `text:<glob-or-path>`
 * Example:     `text:/tmp/my-conversation.txt`
 */
export class TextAdapter implements SourceAdapter {
  readonly name = "text";

  match(spec: string): boolean {
    return spec.startsWith("text:");
  }

  async list(spec: string): Promise<string[]> {
    const pattern = resolveSpec(spec, "text:");
    return expandGlob(pattern);
  }

  async read(filePath: string): Promise<TranscriptChunk> {
    const text = await fs.readFile(filePath, "utf-8");
    const sourceId = stableId(filePath);
    return { sourceId, text, byteOffset: 0 };
  }
}

// ---------------------------------------------------------------------------
// Helpers (shared by all adapters in this package)
// ---------------------------------------------------------------------------

/** Strip the "<prefix>:" part and expand ~ to HOME. */
export function resolveSpec(spec: string, prefix: string): string {
  const raw = spec.slice(prefix.length);
  return raw.startsWith("~") ? path.join(process.env.HOME ?? "~", raw.slice(1)) : raw;
}

/** Stable deterministic id from a file path. */
export function stableId(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

/** Expand a glob pattern into concrete file paths, sorted. */
export async function expandGlob(pattern: string): Promise<string[]> {
  // Check if pattern contains glob characters
  if (/[*?{}\[\]]/.test(pattern)) {
    try {
      const matches: string[] = [];
      // Determine base dir and relative pattern
      const parts = pattern.split("/");
      let baseDir = "/";
      let relPattern = pattern;

      // Find the last non-glob segment to use as base
      const firstGlobIdx = parts.findIndex((p) => /[*?{}\[\]]/.test(p));
      if (firstGlobIdx > 0) {
        baseDir = parts.slice(0, firstGlobIdx).join("/") || "/";
        relPattern = parts.slice(firstGlobIdx).join("/");
      }

      for await (const match of glob(relPattern, { cwd: baseDir })) {
        matches.push(path.join(baseDir, match));
      }
      return matches.sort();
    } catch {
      return [];
    }
  }

  // Non-glob: check the file exists
  try {
    await fs.access(pattern);
    return [pattern];
  } catch {
    return [];
  }
}
