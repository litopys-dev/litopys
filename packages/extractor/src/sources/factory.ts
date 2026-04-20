import { ClaudeCodeAdapter } from "./claude-code.ts";
import { JsonlAdapter } from "./jsonl.ts";
import { TextAdapter } from "./text.ts";
import type { SourceAdapter } from "./types.ts";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY: SourceAdapter[] = [
  new TextAdapter(),
  new JsonlAdapter(),
  new ClaudeCodeAdapter(),
];

/**
 * Find the first registered adapter that can handle the given spec.
 * Returns undefined if no adapter matches — caller should handle this as an error.
 */
export function selectAdapter(spec: string): SourceAdapter | undefined {
  return REGISTRY.find((a) => a.match(spec));
}

/**
 * Return the list of all registered adapter names, for help text / diagnostics.
 */
export function registeredAdapterNames(): string[] {
  return REGISTRY.map((a) => a.name);
}
