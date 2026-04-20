/**
 * Litopys MCP startup-context resource.
 *
 * Exposes a single resource at `litopys://startup-context` that returns a
 * compressed markdown snapshot of the graph: owner profile, active projects,
 * recent events, and key lessons, plus basic statistics.
 *
 * ENV controls:
 *   LITOPYS_STARTUP_CONTEXT_DISABLED=1  — do not register the resource at all
 *   LITOPYS_STARTUP_CONTEXT_LIMIT=N     — override top-N for every section
 */

import type { AnyNode } from "@litopys/core";
import { loadGraph } from "@litopys/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RESOURCE_URI = "litopys://startup-context";
export const RESOURCE_NAME = "startup-context";
export const RESOURCE_TITLE = "Litopys startup context";
export const RESOURCE_DESCRIPTION =
  "Compressed snapshot of the graph: owner profile, active projects, recent events, key lessons. Read on connect for immediate context.";
export const RESOURCE_MIME_TYPE = "text/markdown";

/** Rough byte cap for the generated context to avoid bloating client prompts. */
const MAX_BYTES = 6144; // 6 KB

// ---------------------------------------------------------------------------
// ENV helpers
// ---------------------------------------------------------------------------

export function isDisabled(): boolean {
  return process.env.LITOPYS_STARTUP_CONTEXT_DISABLED === "1";
}

function resolveLimit(defaultValue: number): number {
  const env = process.env.LITOPYS_STARTUP_CONTEXT_LIMIT;
  if (env && env.trim().length > 0) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return defaultValue;
}

// ---------------------------------------------------------------------------
// Context generator
// ---------------------------------------------------------------------------

/**
 * Generates the startup-context markdown for the graph at `dir`.
 * The output is capped at ~6 KB so it is safe to embed in agent context.
 */
export async function generateStartupContext(dir: string): Promise<string> {
  const graph = await loadGraph(dir);
  const nodes = Array.from(graph.nodes.values());

  const limit = resolveLimit(10);

  // Helpers
  function byUpdatedDesc(a: AnyNode, b: AnyNode): number {
    return (b.updated ?? "").localeCompare(a.updated ?? "");
  }

  function shortSummary(node: AnyNode): string {
    return node.summary ?? node.id;
  }

  // ---------------------------------------------------------------------------
  // Owner profile
  // ---------------------------------------------------------------------------

  const ownerNodes = nodes.filter((n) => n.type === "person" && n.tags?.includes("owner"));
  let ownerSection = "";
  if (ownerNodes.length > 0) {
    const owner = ownerNodes[0];
    ownerSection =
      `## Owner\n\n**${shortSummary(owner)}** (\`${owner.id}\`)` +
      (owner.tags && owner.tags.length > 0 ? ` — tags: ${owner.tags.join(", ")}` : "") +
      "\n\n" +
      (owner.body ? owner.body.trim() + "\n" : "");
  }

  // ---------------------------------------------------------------------------
  // Active projects
  // ---------------------------------------------------------------------------

  const projects = nodes
    .filter((n) => n.type === "project")
    .sort(byUpdatedDesc)
    .slice(0, limit);

  let projectsSection = "";
  if (projects.length > 0) {
    const totalProjects = nodes.filter((n) => n.type === "project").length;
    const moreProjects = totalProjects - projects.length;
    const lines = projects.map((p) => `- \`${p.id}\` — ${shortSummary(p)}`);
    if (moreProjects > 0) lines.push(`- … ${moreProjects} more`);
    projectsSection = `## Active Projects\n\n${lines.join("\n")}\n`;
  }

  // ---------------------------------------------------------------------------
  // Recent events
  // ---------------------------------------------------------------------------

  const events = nodes
    .filter((n) => n.type === "event")
    .sort(byUpdatedDesc)
    .slice(0, limit);

  let eventsSection = "";
  if (events.length > 0) {
    const totalEvents = nodes.filter((n) => n.type === "event").length;
    const moreEvents = totalEvents - events.length;
    const lines = events.map((e) => {
      const when = (e as unknown as { since?: string }).since ?? e.updated ?? "";
      return `- \`${e.id}\`${when ? ` (${when})` : ""} — ${shortSummary(e)}`;
    });
    if (moreEvents > 0) lines.push(`- … ${moreEvents} more`);
    eventsSection = `## Recent Events\n\n${lines.join("\n")}\n`;
  }

  // ---------------------------------------------------------------------------
  // Key lessons
  // ---------------------------------------------------------------------------

  const lessons = nodes
    .filter((n) => n.type === "lesson")
    .sort(byUpdatedDesc)
    .slice(0, limit);

  let lessonsSection = "";
  if (lessons.length > 0) {
    const totalLessons = nodes.filter((n) => n.type === "lesson").length;
    const moreLessons = totalLessons - lessons.length;
    const lines = lessons.map((l) => `- \`${l.id}\` — ${shortSummary(l)}`);
    if (moreLessons > 0) lines.push(`- … ${moreLessons} more`);
    lessonsSection = `## Key Lessons\n\n${lines.join("\n")}\n`;
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  const typeCounts: Record<string, number> = {};
  for (const n of nodes) {
    typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  }
  const typesSummary = Object.entries(typeCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([t, c]) => `${c} ${t}`)
    .join(", ");

  // Count edges (sum all rels arrays)
  let totalEdges = 0;
  for (const n of nodes) {
    if (n.rels) {
      for (const targets of Object.values(n.rels)) {
        totalEdges += (targets as string[]).length;
      }
    }
  }

  const statsSection = `## Graph Statistics\n\n${nodes.length} nodes (${typesSummary}), ${totalEdges} edges\n`;

  // ---------------------------------------------------------------------------
  // Assemble + cap
  // ---------------------------------------------------------------------------

  const sections = [ownerSection, projectsSection, eventsSection, lessonsSection, statsSection]
    .filter(Boolean)
    .join("\n");

  const header = `# Litopys Startup Context\n\n_Graph snapshot — ${new Date().toISOString().slice(0, 10)}_\n\n`;
  const full = header + sections;

  if (Buffer.byteLength(full, "utf8") <= MAX_BYTES) {
    return full;
  }

  // Trim to MAX_BYTES at a line boundary
  const encoded = Buffer.from(full, "utf8").slice(0, MAX_BYTES).toString("utf8");
  const lastNewline = encoded.lastIndexOf("\n");
  const trimmed = lastNewline > 0 ? encoded.slice(0, lastNewline) : encoded;
  return trimmed + "\n\n_… truncated (graph too large for startup context)_\n";
}
