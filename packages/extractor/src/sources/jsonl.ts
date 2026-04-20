import { promises as fs } from "node:fs";
import type { SourceAdapter, TranscriptChunk } from "./types.ts";
import { expandGlob, resolveSpec, stableId } from "./text.ts";

/**
 * JsonlAdapter — generic JSONL, one JSON object per line.
 *
 * Expects lines with at least `role` and `content` fields (OpenAI chat format).
 * Lines that don't parse or lack both fields are silently skipped.
 *
 * Spec format: `jsonl:<glob-or-path>`
 * Example:     `jsonl:/path/to/chat-export.jsonl`
 */
export class JsonlAdapter implements SourceAdapter {
  readonly name = "jsonl";

  match(spec: string): boolean {
    return spec.startsWith("jsonl:");
  }

  async list(spec: string): Promise<string[]> {
    const pattern = resolveSpec(spec, "jsonl:");
    return expandGlob(pattern);
  }

  async read(filePath: string): Promise<TranscriptChunk> {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split("\n");

    const parts: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const role = typeof obj.role === "string" ? obj.role.toUpperCase() : null;
        const content = typeof obj.content === "string" ? obj.content : null;
        if (role && content !== null) {
          parts.push(`${role}: ${content}`);
        }
      } catch {
        // skip non-JSON lines
      }
    }

    const text = parts.join("\n\n");
    const sourceId = stableId(filePath);
    return { sourceId, text, byteOffset: 0 };
  }
}
