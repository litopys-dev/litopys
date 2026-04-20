import { NodeType, RelationName } from "@litopys/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Candidate types
// ---------------------------------------------------------------------------

export const CandidateNodeSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be lowercase kebab-case")
    .describe("Proposed node id"),
  type: NodeType.describe("Node type"),
  summary: z.string().max(200).describe("Short human-readable summary"),
  aliases: z.array(z.string()).optional().describe("Alternative names"),
  tags: z.array(z.string()).optional().describe("Tags"),
  body: z.string().optional().describe("Markdown body with more context"),
  confidence: z.number().min(0).max(1).describe("Extraction confidence 0..1"),
  reasoning: z.string().max(300).describe("One sentence: why this was extracted"),
  sourceSessionId: z.string().describe("Session that produced this candidate"),
});

export type CandidateNode = z.infer<typeof CandidateNodeSchema>;

export const CandidateRelationSchema = z.object({
  type: RelationName.describe("Relation type"),
  sourceId: z.string().describe("Source node id (existing or candidate)"),
  targetId: z.string().describe("Target node id (existing or candidate)"),
  confidence: z.number().min(0).max(1).describe("Extraction confidence 0..1"),
  reasoning: z.string().max(300).describe("One sentence: why this relation was extracted"),
  sourceSessionId: z.string().describe("Session that produced this candidate"),
});

export type CandidateRelation = z.infer<typeof CandidateRelationSchema>;

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface ExtractorInput {
  transcript: string; // plain text or JSONL
  existingNodeIds: string[]; // so LLM doesn't create duplicates
  maxCandidates?: number; // default 20
}

export interface ExtractorOutput {
  candidateNodes: CandidateNode[];
  candidateRelations: CandidateRelation[];
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
}

export interface ExtractorAdapter {
  readonly name: string;
  readonly model: string;
  extract(input: ExtractorInput): Promise<ExtractorOutput>;
}

// ---------------------------------------------------------------------------
// Zod schemas for LLM JSON output validation
// ---------------------------------------------------------------------------

export const LLMOutputSchema = z.object({
  candidateNodes: z.array(CandidateNodeSchema).default([]),
  candidateRelations: z.array(CandidateRelationSchema).default([]),
});

export type LLMOutput = z.infer<typeof LLMOutputSchema>;

// Small local models often omit `sourceSessionId` and `confidence`. We inject
// the session id we already know, and default confidence to 0.5 when missing,
// so otherwise-valid candidates survive validation instead of being dropped.
export function normalizeLLMOutput(parsed: unknown, sessionId: string): unknown {
  if (parsed === null || typeof parsed !== "object") return parsed;
  const obj = parsed as Record<string, unknown>;
  const fill = (item: unknown): unknown => {
    if (item === null || typeof item !== "object") return item;
    const rec = { ...(item as Record<string, unknown>) };
    if (rec.sourceSessionId == null) rec.sourceSessionId = sessionId;
    if (typeof rec.confidence !== "number") rec.confidence = 0.5;
    return rec;
  };
  return {
    ...obj,
    candidateNodes: Array.isArray(obj.candidateNodes)
      ? obj.candidateNodes.map(fill)
      : obj.candidateNodes,
    candidateRelations: Array.isArray(obj.candidateRelations)
      ? obj.candidateRelations.map(fill)
      : obj.candidateRelations,
  };
}
