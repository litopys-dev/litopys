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

/**
 * Why an extraction produced nothing.
 *
 * `extract()` returns an empty candidate list for three very different reasons:
 * the transcript genuinely held no durable facts, the provider call failed, or
 * the model answered with something unparseable. Collapsing all three into
 * "empty" is how a rate-limited hour turns into permanently lost knowledge: the
 * caller advances its read offset over bytes that were never actually examined.
 *
 * - `api`: transport/HTTP failure. The transcript was NOT consumed — retry it.
 * - `unparseable`: the provider answered, but the payload could not be read as
 *   candidates. Retrying the same bytes will fail the same way, so the caller
 *   should move on rather than loop forever.
 */
export interface ExtractorFailure {
  kind: "api" | "unparseable";
  message: string;
}

export interface ExtractorOutput {
  candidateNodes: CandidateNode[];
  candidateRelations: CandidateRelation[];
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
  /** Absent on success (including a legitimately empty extraction). */
  failure?: ExtractorFailure;
}

export interface CompleteInput {
  /**
   * Freeform prompt sent as a single user message. JSON mode is intentionally
   * not forced: callers that want JSON output must instruct the model in the
   * prompt itself and strip markdown code fences from the reply themselves.
   */
  prompt: string;
  maxTokens?: number; // default 2048
}

export interface CompleteOutput {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ExtractorAdapter {
  readonly name: string;
  readonly model: string;
  extract(input: ExtractorInput): Promise<ExtractorOutput>;
  complete(input: CompleteInput): Promise<CompleteOutput>;
}

// ---------------------------------------------------------------------------
// Domain error — thrown by complete() on API/transport failures
// ---------------------------------------------------------------------------

/**
 * Thrown by adapter.complete() when the underlying API call fails due to a
 * transport error, HTTP error (e.g. 429), or network issue.
 *
 * Callers that need LLM output MUST propagate this (do NOT swallow) so that
 * upstream orchestrators (e.g. runEpisodesCatchup) can distinguish a true API
 * failure from "LLM returned valid empty/unparseable response" and take the
 * correct action (abort pass / skip file for retry next tick).
 */
export class AdapterCompleteError extends Error {
  readonly code = "adapter_complete_error";

  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AdapterCompleteError";
  }
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
