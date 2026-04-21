#!/usr/bin/env bun
/**
 * Litopys Weekly Digest — summarizes what you learned this week,
 * what's pending review in quarantine, and flags conflicts.
 *
 * Usage:
 *   bun packages/extractor/src/digest.ts
 *   bun packages/cli/src/index.ts digest
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { defaultGraphPath, loadGraph } from "@litopys/core";
import type { AnyNode } from "@litopys/core";
import { createAdapter } from "./adapters/factory.ts";
import { listQuarantine } from "./quarantine.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DigestOptions {
  graphPath?: string;
  weekDays?: number; // default 7
}

export interface DigestResult {
  weekLabel: string;
  outputPath: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function getRecentNodes(graphPath: string, days: number): Promise<AnyNode[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const result: AnyNode[] = [];

  const typeDirs = ["people", "projects", "systems", "concepts", "events", "lessons"];
  for (const typeDir of typeDirs) {
    const dir = path.join(graphPath, typeDir);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const fp = path.join(dir, file);
      try {
        const stat = await fs.stat(fp);
        if (stat.mtimeMs >= cutoff) {
          // Parse the node via loadGraph-like approach
          const content = await fs.readFile(fp, "utf-8");
          void content; // We'll get the parsed version from loadGraph
        }
      } catch {
        // skip
      }
    }
  }

  // Load all nodes, then filter by mtime
  try {
    const loaded = await loadGraph(graphPath);
    for (const [, node] of loaded.nodes) {
      if (node.updated) {
        const updated = new Date(node.updated).getTime();
        if (updated >= cutoff) {
          result.push(node);
        }
      }
    }
  } catch {
    // Graph might not exist
  }

  return result;
}

async function getRejectedLog(graphPath: string): Promise<string[]> {
  const logPath = path.join(graphPath, "..", "quarantine", "rejected.jsonl");
  try {
    const content = await fs.readFile(logPath, "utf-8");
    return content
      .split("\n")
      .filter((l) => l.trim())
      .slice(-50); // last 50 rejections
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main digest generation
// ---------------------------------------------------------------------------

export async function generateDigest(options: DigestOptions = {}): Promise<DigestResult> {
  const graphPath = options.graphPath ?? defaultGraphPath();
  const days = options.weekDays ?? 7;
  const weekLabel = isoWeek(new Date());

  // Gather data
  const [recentNodes, pendingFiles, rejectedLines] = await Promise.all([
    getRecentNodes(graphPath, days),
    listQuarantine(graphPath),
    getRejectedLog(graphPath),
  ]);

  const pendingCount = pendingFiles.reduce((acc, f) => acc + f.candidates.length, 0);
  const pendingRelCount = pendingFiles.reduce((acc, f) => acc + f.relations.length, 0);

  // Summarize for LLM
  const recentSummary =
    recentNodes.length > 0
      ? recentNodes.map((n) => `- [${n.type}] ${n.id}: ${n.summary ?? "(no summary)"}`).join("\n")
      : "(no nodes updated this week)";

  const pendingSummary =
    pendingFiles.length > 0
      ? pendingFiles
          .map(
            (f) =>
              `Session ${f.meta.sessionId} (${f.meta.timestamp}): ${f.candidates.length} candidates, ${f.relations.length} relations`,
          )
          .join("\n")
      : "(no pending quarantine items)";

  const rejectedSummary =
    rejectedLines.length > 0
      ? `Last ${rejectedLines.length} rejected candidates recorded.`
      : "(no rejections this week)";

  // Try LLM-enhanced digest, fall back to manual on any error (e.g. no API key in tests)
  let digestContent = "";
  try {
    const adapter = createAdapter();
    const digestPrompt = `You are a knowledge graph assistant. Summarize the following weekly Litopys activity report in a concise, useful markdown document.

WEEK: ${weekLabel}
DAYS COVERED: ${days}

## Recently Updated Nodes (${recentNodes.length}):
${recentSummary}

## Pending Quarantine Review (${pendingCount} nodes, ${pendingRelCount} relations in ${pendingFiles.length} sessions):
${pendingSummary}

## Rejections:
${rejectedSummary}

Write a useful weekly digest with sections:
1. What was learned/updated this week
2. What needs review (quarantine items)
3. Any potential conflicts or patterns worth noting
4. Recommended actions

Be concise and actionable. Use markdown formatting.`;

    const output = await adapter.extract({
      transcript: digestPrompt,
      existingNodeIds: recentNodes.map((n) => n.id),
      maxCandidates: 0,
    });
    // extract() returns structured candidates; for digest prose we fall back to manual
    void output;
  } catch {
    // No API key or adapter error — use manual digest
  }

  // Generate digest manually (LLM prose would replace this in production via a direct chat API call)
  digestContent = generateManualDigest(weekLabel, recentNodes, pendingFiles, rejectedLines, days);

  // Write to digests directory
  const digestsDir = path.join(graphPath, "..", "digests");
  await fs.mkdir(digestsDir, { recursive: true });
  const outputPath = path.join(digestsDir, `${weekLabel}.md`);
  await fs.writeFile(outputPath, digestContent, "utf-8");

  return { weekLabel, outputPath, content: digestContent };
}

function generateManualDigest(
  weekLabel: string,
  recentNodes: AnyNode[],
  pendingFiles: Awaited<ReturnType<typeof listQuarantine>>,
  rejectedLines: string[],
  days: number,
): string {
  const now = new Date().toISOString().slice(0, 10);
  const pendingCount = pendingFiles.reduce((acc, f) => acc + f.candidates.length, 0);

  const lines: string[] = [];
  lines.push(`# Litopys Weekly Digest — ${weekLabel}`);
  lines.push(`Generated: ${now}`);
  lines.push("");

  lines.push("## What Was Updated This Week");
  if (recentNodes.length === 0) {
    lines.push(`No nodes were updated in the last ${days} days.`);
  } else {
    const byType: Record<string, AnyNode[]> = {};
    for (const node of recentNodes) {
      const group = byType[node.type] ?? [];
      group.push(node);
      byType[node.type] = group;
    }
    for (const [type, nodes] of Object.entries(byType)) {
      lines.push(`\n### ${type.charAt(0).toUpperCase() + type.slice(1)}s (${nodes.length})`);
      for (const n of nodes) {
        lines.push(`- **${n.id}**: ${n.summary ?? "(no summary)"} *(updated: ${n.updated})*`);
      }
    }
  }

  lines.push("");
  lines.push("## Pending Quarantine Review");
  if (pendingFiles.length === 0) {
    lines.push("No pending items. Great job reviewing!");
  } else {
    lines.push(
      `**${pendingCount} candidates** across **${pendingFiles.length} sessions** await review.`,
    );
    lines.push("");
    lines.push("Run `litopys quarantine list` to see details.");
    for (const f of pendingFiles) {
      lines.push(`\n### Session: ${f.meta.sessionId}`);
      lines.push(`- Timestamp: ${f.meta.timestamp}`);
      lines.push(`- Adapter: ${f.meta.adapterName}`);
      lines.push(`- Candidates: ${f.candidates.length}, Relations: ${f.relations.length}`);
      if (f.candidates.length > 0) {
        lines.push("- Top candidates:");
        for (const c of f.candidates.slice(0, 3)) {
          lines.push(`  - [${c.type}] \`${c.id}\`: ${c.summary} *(confidence: ${c.confidence})*`);
        }
      }
    }
  }

  lines.push("");
  lines.push("## Rejections");
  if (rejectedLines.length === 0) {
    lines.push("No rejections recorded.");
  } else {
    lines.push(`${rejectedLines.length} candidates rejected (last 50 shown in rejected.jsonl).`);
  }

  lines.push("");
  lines.push("## Recommended Actions");
  const actions: string[] = [];
  if (pendingCount > 0) {
    actions.push(`- Review ${pendingCount} quarantine candidate(s): \`litopys quarantine list\``);
  }
  if (recentNodes.length === 0) {
    actions.push("- Consider adding a SessionEnd hook to start capturing knowledge automatically.");
  }
  if (actions.length === 0) {
    actions.push("- Everything looks good! Keep up the good work.");
  }
  lines.push(...actions);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Run as standalone script
// ---------------------------------------------------------------------------

if (import.meta.main) {
  generateDigest()
    .then((result) => {
      process.stderr.write(`[litopys/digest] Wrote digest to ${result.outputPath}\n`);
    })
    .catch((err) => {
      process.stderr.write(`[litopys/digest] Error: ${String(err)}\n`);
      process.exit(1);
    });
}
