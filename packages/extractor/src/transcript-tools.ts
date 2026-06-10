/**
 * transcript-tools.ts — tool-aware Claude Code transcript parsing.
 *
 * Extends the plain text extraction from sources/claude-code.ts with an
 * optional "summary" mode that emits TOOL: lines and counts tool ops / errors.
 * In default mode (no includeTools) behaviour is backward-compatible with the
 * existing parseContent("claude-code") path in daemon/tick.ts.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedTranscript {
  text: string;
  toolOps: number;
  errorCount: number;
  sessionId?: string;
}

export interface ParseOptions {
  includeTools?: "summary";
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string;
  // text block
  text?: string;
  // tool_use block
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result block
  tool_use_id?: string;
  is_error?: boolean;
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw Claude Code JSONL transcript string into a structured result.
 *
 * @param raw  - Full JSONL content (newline-separated JSON objects).
 * @param opts - `{ includeTools: "summary" }` to emit TOOL: lines in text.
 */
export function parseClaudeCodeTranscript(
  raw: string,
  opts: ParseOptions = {},
): ParsedTranscript {
  const includeTools = opts.includeTools === "summary";

  // Parse lines into events, skipping broken JSON.
  // NOTE: this diverges from parseJsonlContent in daemon/tick.ts, which
  // slices at lastIndexOf("\n") and therefore drops the final line even when
  // it is complete JSON (its input is an incrementally-tailed file where the
  // last line may still be mid-write). This module receives complete
  // in-memory transcripts, so we try-parse every line including the tail;
  // a genuinely partial tail simply fails JSON.parse and is skipped.
  const events: ClaudeCodeEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as ClaudeCodeEvent);
    } catch {
      // Skip broken / partial JSON lines
    }
  }

  // Pass 1: build maps of tool_use id → name and id → input gist.
  // These are needed when we later encounter tool_result blocks.
  const toolNameMap = new Map<string, string>();
  const toolGistMap = new Map<string, string>();

  for (const ev of events) {
    if (ev.type !== "assistant") continue;
    for (const b of normalizeContent(ev.message?.content)) {
      if (b.type === "tool_use" && b.id) {
        if (b.name) toolNameMap.set(b.id, b.name);
        toolGistMap.set(b.id, inputGist(b.input ?? {}));
      }
    }
  }

  // Pass 2: produce text parts and accumulate counters.
  let sessionId: string | undefined;
  let toolOps = 0;
  let errorCount = 0;
  const parts: string[] = [];

  for (const ev of events) {
    if (!sessionId && typeof ev.sessionId === "string") {
      sessionId = ev.sessionId;
    }

    const type = ev.type;
    if (type !== "user" && type !== "assistant") continue;

    const msg = ev.message;
    if (!msg) continue;

    const role =
      typeof msg.role === "string"
        ? msg.role.toUpperCase()
        : String(type).toUpperCase();

    const blocks = normalizeContent(msg.content);
    const textParts: string[] = [];

    for (const b of blocks) {
      if (b.type === "text" && typeof b.text === "string") {
        const t = b.text.trim();
        if (t) textParts.push(t);
      } else if (b.type === "tool_use") {
        toolOps++;
        // tool_use lines are emitted alongside tool_result so status is known.
        // No text emission here.
      } else if (b.type === "tool_result") {
        const isError = detectError(b);
        if (isError) errorCount++;

        if (includeTools) {
          const toolId = b.tool_use_id ?? "";
          const toolName = toolNameMap.get(toolId) ?? "Tool";
          const gist = toolGistMap.get(toolId) ?? "";
          const status = isError ? "error" : "ok";
          parts.push(`TOOL: ${toolName}(${gist}) → ${status}`);
        }
      }
    }

    if (textParts.length > 0) {
      parts.push(`${role}: ${textParts.join("\n").trim()}`);
    }
  }

  return {
    text: parts.join("\n\n"),
    toolOps,
    errorCount,
    sessionId,
  };
}

// ---------------------------------------------------------------------------
// Session date helper
// ---------------------------------------------------------------------------

/**
 * Extract a deterministic session date (YYYY-MM-DD) from the raw JSONL transcript.
 *
 * CONTRACT: the returned date is derived from the session content, NOT from the
 * processing date (i.e. NOT `new Date().toISOString().slice(0,10)`).
 * This is critical for appendEpisodes() deduplication correctness: re-processing
 * the same session in a different calendar month must produce the same date so
 * that the episode id maps to the same monthly JSONL file.
 *
 * Implementation: scan JSONL lines in order and return `.slice(0,10)` of the
 * first parseable event that carries a `timestamp` field containing a valid
 * ISO date string. The timestamp MUST start with `YYYY-MM-DD` — non-ISO
 * formats that Date can still parse (e.g. "06/10/2026") are rejected, because
 * slicing them would yield a garbage "date" that poisons every episode
 * downstream. Returns `undefined` when no such event is found (e.g. very
 * short synthetic transcripts without timestamps).
 *
 * @param raw - Full JSONL content of the session transcript.
 */
const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

export function sessionDateFromTranscript(raw: string): string | undefined {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (ev === null || typeof ev !== "object") continue;
    const ts = (ev as Record<string, unknown>).timestamp;
    if (typeof ts !== "string") continue;
    // Must start with an ISO date so slice(0,10) is meaningful…
    if (!ISO_DATE_PREFIX_RE.test(ts)) continue;
    // …and be a real calendar date (rejects e.g. "2026-13-45T…")
    const d = new Date(ts);
    if (isNaN(d.getTime())) continue;
    return ts.slice(0, 10);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize message content to an array of ContentBlock. */
function normalizeContent(
  content: string | ContentBlock[] | undefined,
): ContentBlock[] {
  if (!content) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content;
}

/** Extract a short, one-line gist from tool_use input. */
function inputGist(input: Record<string, unknown>): string {
  let gist: string;
  if (typeof input.command === "string") {
    gist = input.command;
  } else if (typeof input.file_path === "string") {
    gist = input.file_path;
  } else {
    gist = JSON.stringify(input).slice(0, 60);
  }
  // Collapse newlines/runs of whitespace so multi-line commands stay one line.
  return gist.replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Determine whether a tool_result block represents an error. */
function detectError(block: ContentBlock): boolean {
  if (block.is_error === true) return true;

  const c = block.content;
  if (typeof c === "string") {
    return /^Exit code [1-9]/.test(c) || /^Error/.test(c);
  }
  if (Array.isArray(c)) {
    for (const sub of c) {
      if (sub.type === "text" && typeof sub.text === "string") {
        if (/^Exit code [1-9]/.test(sub.text) || /^Error/.test(sub.text)) return true;
      }
    }
  }
  return false;
}
