/**
 * llm-utils.ts — shared helpers for parsing/templating LLM completions.
 *
 * Used by episodes.ts (Stage A) and skill-draft.ts (Stage B). Retry/log/give-up
 * orchestration intentionally stays per-module (messages and contracts differ);
 * only the parsing core is consolidated here.
 */

// ---------------------------------------------------------------------------
// Output budget
// ---------------------------------------------------------------------------

/**
 * Output token budget for every extractor LLM call.
 *
 * gemini-2.5-flash spends thinking tokens from the same output budget, so a low
 * cap truncates JSON mid-response: the closing code fence never prints,
 * stripCodeFences can't pair the fences, and JSON.parse chokes on the leading
 * ```json. Both the call and its retry then burn quota for nothing. 16384 is the
 * value Stage A (episodes) settled on; keeping every call on one constant stops
 * a single forgotten site from regressing (clustering was stuck at 2048, draft
 * generation at 4096 — see the 2026-06-12 episodes fix that missed them).
 */
export const EXTRACTOR_MAX_TOKENS = 16_384;

// ---------------------------------------------------------------------------
// Code fences
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences from an LLM response if present.
 * Handles any language tag (```json, ```markdown, ```...) and bare ``` fences
 * that wrap the ENTIRE text. Inner fences are left untouched.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z]*)?\s*\n([\s\S]*?)\n?```\s*$/);
  if (fenceMatch?.[1] !== undefined) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Safe template substitution
// ---------------------------------------------------------------------------

/**
 * Safe string replacement using a function replacer to avoid $-pattern
 * expansion ($&, $', $`) that a plain string replacement would apply —
 * transcripts and episode payloads often contain $ (Bash snippets).
 * Regression class: commit 8f23f3b.
 */
export function safeReplace(template: string, needle: string, replacement: string): string {
  return template.replace(needle, () => replacement);
}

// ---------------------------------------------------------------------------
// Keyed-array JSON parsing
// ---------------------------------------------------------------------------

/**
 * Parse LLM response text expected to be a JSON object of shape
 * `{ <key>: [...] }` (after optional code fences). Returns the array on
 * success, or null on JSON parse failure / wrong shape.
 */
export function parseKeyedArray(text: string, key: string): unknown[] | null {
  const stripped = stripCodeFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    key in (parsed as object) &&
    Array.isArray((parsed as Record<string, unknown>)[key])
  ) {
    return (parsed as Record<string, unknown>)[key] as unknown[];
  }
  return null;
}
