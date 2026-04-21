/**
 * Litopys MCP server-level instructions.
 *
 * This text is embedded in the MCP initialize response and injected by any
 * MCP-compatible client (Claude Code, Claude Desktop, Cursor, Cline, etc.)
 * into the agent's system prompt automatically.
 *
 * Override via environment variable LITOPYS_MCP_INSTRUCTIONS if you need
 * custom behaviour for a specific deployment.
 */
export const DEFAULT_INSTRUCTIONS = `\
You have access to Litopys — a persistent graph-based knowledge memory. \
The graph holds typed nodes (person, project, system, concept, event, lesson) \
connected by 11 relation types (owns, prefers, learned_from, uses, applies_to, \
conflicts_with, runs_on, depends_on, reinforces, mentioned_in, supersedes). \
All reads/writes go through five tools: litopys_search, litopys_get, \
litopys_create, litopys_link, litopys_related.

Behavioral rules — follow these for every conversation:

1. SEARCH FIRST. Before answering questions about the user, their projects, \
systems, tools, preferences, or past decisions — call litopys_search. \
Do not rely on in-context recall alone.

2. CREATE ON LEARNING. When a new stable fact emerges (a preference, a \
project decision, a technical constraint, a lesson from an incident) — call \
litopys_create. A fact is stable if it is likely to recur across sessions. \
Skip one-off details (single file paths, temporary variable names, port \
numbers that may change).

3. LINK AFTER CREATING. If the new node relates to an existing one — call \
litopys_link immediately after litopys_create. Do not leave nodes isolated \
when a relation is obvious.

4. AVOID DUPLICATES. Before creating, run litopys_search to check for \
existing nodes or aliases. Only create if nothing matches.

5. QUALITY THRESHOLD. Only store facts with confidence >= 0.7. Use \
kebab-case for node ids (e.g. alice-project, web-scraper-v2).

These rules are client-agnostic and apply equally in Claude Code, \
Claude Desktop, Cursor, Cline, or any other MCP-compatible host.\
`;

/**
 * Returns the effective instructions string.
 * If LITOPYS_MCP_INSTRUCTIONS env var is set and non-empty, it overrides
 * the default.
 */
export function resolveInstructions(): string {
  const env = process.env.LITOPYS_MCP_INSTRUCTIONS;
  if (env && env.trim().length > 0) {
    return env;
  }
  return DEFAULT_INSTRUCTIONS;
}
