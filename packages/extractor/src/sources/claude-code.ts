import { promises as fs } from "node:fs";
import { expandGlob, resolveSpec, stableId } from "./text.ts";
import type { SourceAdapter, TranscriptChunk } from "./types.ts";

/**
 * ClaudeCodeAdapter — reads Claude Code session JSONL files.
 *
 * Claude Code JSONL format: each line is a JSON object with:
 *   - `type`: "user" | "assistant" | "file-history-snapshot" | ...
 *   - `sessionId`: string (present on conversation events)
 *   - `message`: { role: "user"|"assistant", content: string | ContentBlock[] }
 *
 * ContentBlock can be: { type: "text", text: string }
 *                    | { type: "thinking", thinking: string }
 *                    | { type: "tool_use", name: string, input: unknown }
 *                    | { type: "tool_result", content: string | ContentBlock[] }
 *
 * We extract human messages and assistant text blocks; skip tool use/results
 * (they're implementation noise, not durable knowledge).
 *
 * Spec format: `claude-code:<glob-or-path>`
 * Example:     claude-code:~/.claude/projects/PROJ/abc-123.jsonl
 */
export class ClaudeCodeAdapter implements SourceAdapter {
  readonly name = "claude-code";

  match(spec: string): boolean {
    return spec.startsWith("claude-code:");
  }

  async list(spec: string): Promise<string[]> {
    const pattern = resolveSpec(spec, "claude-code:");
    return expandGlob(pattern);
  }

  async read(filePath: string): Promise<TranscriptChunk> {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split("\n");

    let sessionId: string | undefined;
    const parts: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let obj: ClaudeCodeEvent;
      try {
        obj = JSON.parse(trimmed) as ClaudeCodeEvent;
      } catch {
        continue;
      }

      // Capture sessionId from first event that has it
      if (!sessionId && typeof obj.sessionId === "string") {
        sessionId = obj.sessionId;
      }

      // Only process conversation turns (user/assistant)
      const type = obj.type;
      if (type !== "user" && type !== "assistant") continue;

      const msg = obj.message;
      if (!msg) continue;

      const role = msg.role?.toUpperCase() ?? type.toUpperCase();
      const text = extractText(msg.content);
      if (text) {
        parts.push(`${role}: ${text}`);
      }
    }

    return {
      sourceId: stableId(filePath),
      sessionId,
      text: parts.join("\n\n"),
      byteOffset: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal types (local only — not exported)
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  content?: string | ContentBlock[];
}

interface ClaudeCodeMessage {
  role?: string;
  content?: string | ContentBlock[];
}

interface ClaudeCodeEvent {
  type?: string;
  sessionId?: string;
  message?: ClaudeCodeMessage;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract readable text from a Claude message content (string or block array). */
function extractText(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content.trim();

  const texts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text.trim());
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      // Skip thinking blocks — internal reasoning, not useful for extraction
    }
    // Skip tool_use and tool_result — implementation noise
  }
  return texts.join("\n").trim();
}
