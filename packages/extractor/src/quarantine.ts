import { promises as fs } from "node:fs";
import * as path from "node:path";
import { defaultGraphPath, loadGraph, writeNode } from "@litopys/core";
import type { AnyNode } from "@litopys/core";
import type { CandidateNode, CandidateRelation } from "./adapters/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuarantineMeta {
  sessionId: string;
  timestamp: string;
  adapterName: string;
}

export interface QuarantineFile {
  filePath: string;
  meta: QuarantineMeta;
  candidates: CandidateNode[];
  relations: CandidateRelation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quarantineDir(graphPath: string): string {
  return path.join(graphPath, "..", "quarantine");
}

function rejectedLog(graphPath: string): string {
  return path.join(quarantineDir(graphPath), "rejected.jsonl");
}

/**
 * Serialize quarantine file contents as markdown with YAML frontmatter.
 * We embed the structured data as a JSON code block for easy parsing.
 */
function serialize(
  candidates: CandidateNode[],
  relations: CandidateRelation[],
  meta: QuarantineMeta,
): string {
  const frontmatter = {
    sessionId: meta.sessionId,
    timestamp: meta.timestamp,
    adapterName: meta.adapterName,
    candidateCount: candidates.length,
    relationCount: relations.length,
  };

  const lines: string[] = [];
  lines.push("---");
  for (const [k, v] of Object.entries(frontmatter)) {
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---");
  lines.push("");
  lines.push("# Quarantine Candidates");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify({ candidates, relations }, null, 2));
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

/** Parse a quarantine markdown file back into structured data. */
function deserialize(content: string, filePath: string): QuarantineFile {
  // Extract YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch || !fmMatch[1]) {
    throw new Error(`Invalid quarantine file format: ${filePath}`);
  }

  const meta: Partial<QuarantineMeta> = {};
  for (const line of fmMatch[1].split("\n")) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 2);
    try {
      const parsed = JSON.parse(val) as unknown;
      if (key === "sessionId" || key === "timestamp" || key === "adapterName") {
        if (typeof parsed === "string") {
          (meta as Record<string, string>)[key] = parsed;
        }
      }
    } catch {
      // ignore non-JSON values
    }
  }

  // Extract JSON code block
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch || !jsonMatch[1]) {
    return {
      filePath,
      meta: meta as QuarantineMeta,
      candidates: [],
      relations: [],
    };
  }

  let data: { candidates?: CandidateNode[]; relations?: CandidateRelation[] };
  try {
    data = JSON.parse(jsonMatch[1]) as {
      candidates?: CandidateNode[];
      relations?: CandidateRelation[];
    };
  } catch {
    data = {};
  }

  return {
    filePath,
    meta: meta as QuarantineMeta,
    candidates: data.candidates ?? [],
    relations: data.relations ?? [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write a new quarantine file for a session.
 * Returns the path to the written file.
 */
export async function writeQuarantine(
  candidates: CandidateNode[],
  relations: CandidateRelation[],
  meta: QuarantineMeta,
): Promise<string> {
  const graphPath = defaultGraphPath();
  const dir = quarantineDir(graphPath);
  await fs.mkdir(dir, { recursive: true });

  const safeName = meta.sessionId.replace(/[^a-z0-9-]/gi, "-").slice(0, 64);
  const fileName = `${meta.timestamp.replace(/:/g, "-")}-${safeName}.md`;
  const filePath = path.join(dir, fileName);

  await fs.writeFile(filePath, serialize(candidates, relations, meta), "utf-8");
  return filePath;
}

/**
 * Write a quarantine file to an explicit directory (for testing / custom paths).
 */
export async function writeQuarantineTo(
  candidates: CandidateNode[],
  relations: CandidateRelation[],
  meta: QuarantineMeta,
  dir: string,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });

  const safeName = meta.sessionId.replace(/[^a-z0-9-]/gi, "-").slice(0, 64);
  const fileName = `${meta.timestamp.replace(/:/g, "-")}-${safeName}.md`;
  const filePath = path.join(dir, fileName);

  await fs.writeFile(filePath, serialize(candidates, relations, meta), "utf-8");
  return filePath;
}

/**
 * List all pending quarantine files (non-rejected).
 */
export async function listQuarantine(graphPath: string): Promise<QuarantineFile[]> {
  const dir = quarantineDir(graphPath);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
  const result: QuarantineFile[] = [];

  for (const f of mdFiles) {
    const filePath = path.join(dir, f);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      result.push(deserialize(content, filePath));
    } catch (err) {
      process.stderr.write(`[litopys/quarantine] Failed to read ${filePath}: ${String(err)}\n`);
    }
  }

  return result;
}

/**
 * List all pending quarantine files from a specific directory (for testing).
 */
export async function listQuarantineFrom(dir: string): Promise<QuarantineFile[]> {
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
  const result: QuarantineFile[] = [];

  for (const f of mdFiles) {
    const filePath = path.join(dir, f);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      result.push(deserialize(content, filePath));
    } catch (err) {
      process.stderr.write(`[litopys/quarantine] Failed to read ${filePath}: ${String(err)}\n`);
    }
  }

  return result;
}

/**
 * Promote a candidate node to the real graph.
 * - Creates the node via writeNode from @litopys/core
 * - Removes the candidate from the quarantine file
 * - If file is empty, deletes it
 */
export async function promoteCandidate(
  quarantineFilePath: string,
  candidateIndex: number,
  graphPath: string,
): Promise<void> {
  const content = await fs.readFile(quarantineFilePath, "utf-8");
  const qFile = deserialize(content, quarantineFilePath);

  const candidate = qFile.candidates[candidateIndex];
  if (!candidate) {
    throw new Error(
      `No candidate at index ${candidateIndex} in ${quarantineFilePath} (${qFile.candidates.length} total)`,
    );
  }

  // Build a proper AnyNode from candidate — strip undefined fields to avoid YAML errors
  const today = new Date().toISOString().slice(0, 10);
  const raw: Record<string, unknown> = {
    id: candidate.id,
    type: candidate.type,
    summary: candidate.summary,
    updated: today,
    confidence: candidate.confidence,
  };
  if (candidate.aliases !== undefined) raw.aliases = candidate.aliases;
  if (candidate.tags !== undefined) raw.tags = candidate.tags;
  if (candidate.body !== undefined) raw.body = candidate.body;
  const node = raw as unknown as AnyNode;

  await writeNode(graphPath, node);

  // Find relations for this candidate and create them via toolLink logic
  const promoted = candidate.id;
  const relationsForCandidate = qFile.relations.filter(
    (r) => r.sourceId === promoted || r.targetId === promoted,
  );

  if (relationsForCandidate.length > 0) {
    const loaded = await loadGraph(graphPath);
    const sourceNode = loaded.nodes.get(promoted);
    if (sourceNode) {
      // Process outgoing relations
      const outgoing = relationsForCandidate.filter((r) => r.sourceId === promoted);
      for (const rel of outgoing) {
        // Ensure target exists before linking
        if (loaded.nodes.has(rel.targetId)) {
          const existing = sourceNode.rels?.[rel.type] ?? [];
          if (!existing.includes(rel.targetId)) {
            const newRels = { ...(sourceNode.rels ?? {}) } as Record<string, string[]>;
            const list = newRels[rel.type] ?? [];
            list.push(rel.targetId);
            newRels[rel.type] = list;
            const updatedNode: AnyNode = { ...sourceNode, rels: newRels } as AnyNode;
            await writeNode(graphPath, updatedNode);
          }
        }
      }
    }
  }

  // Remove candidate from the file
  const newCandidates = qFile.candidates.filter((_, i) => i !== candidateIndex);

  if (newCandidates.length === 0 && qFile.relations.length === 0) {
    await fs.unlink(quarantineFilePath);
    return;
  }

  const updatedContent = serialize(newCandidates, qFile.relations, qFile.meta);
  await fs.writeFile(quarantineFilePath, updatedContent, "utf-8");
}

/**
 * Reject a candidate — removes it from the quarantine file and logs to rejected.jsonl.
 */
export async function rejectCandidate(
  quarantineFilePath: string,
  candidateIndex: number,
  graphPath: string,
  reason?: string,
): Promise<void> {
  const content = await fs.readFile(quarantineFilePath, "utf-8");
  const qFile = deserialize(content, quarantineFilePath);

  const candidate = qFile.candidates[candidateIndex];
  if (!candidate) {
    throw new Error(
      `No candidate at index ${candidateIndex} in ${quarantineFilePath} (${qFile.candidates.length} total)`,
    );
  }

  // Audit trail
  const dir = quarantineDir(graphPath);
  await fs.mkdir(dir, { recursive: true });
  const rejectedEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    sessionId: qFile.meta.sessionId,
    candidateId: candidate.id,
    candidateType: candidate.type,
    reason: reason ?? null,
    sourceFile: path.basename(quarantineFilePath),
  });
  await fs.appendFile(rejectedLog(graphPath), `${rejectedEntry}\n`, "utf-8");

  // Remove from file
  const newCandidates = qFile.candidates.filter((_, i) => i !== candidateIndex);

  if (newCandidates.length === 0 && qFile.relations.length === 0) {
    await fs.unlink(quarantineFilePath);
    return;
  }

  const updatedContent = serialize(newCandidates, qFile.relations, qFile.meta);
  await fs.writeFile(quarantineFilePath, updatedContent, "utf-8");
}
