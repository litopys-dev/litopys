import type { ExtractorInput } from "./adapters/types.ts";

// ---------------------------------------------------------------------------
// Extraction prompt — model-agnostic, used by all adapters
// ---------------------------------------------------------------------------

export const NODE_TYPES_DOC = `
NODE TYPES (6 types):
- person    — a human being (real individual, not a role/title)
- project   — a software product, codebase, business initiative, or deliverable
- system    — infrastructure, service, tool, library, framework, or external platform
- concept   — an abstract idea, methodology, principle, pattern, or mental model
- event     — a discrete occurrence with a date/period (meeting, incident, release, decision)
- lesson    — a durable insight or best-practice derived from experience
`.trim();

export const RELATION_TYPES_DOC = `
RELATION TYPES (11 types):
- owns         — person→project|system  (person is the owner/creator)
- prefers      — person→concept  (person consistently prefers this approach)
- learned_from — person→lesson|event  (person learned something from this)
- uses         — person|project|system → system|project  (actively uses/depends on)
- applies_to   — concept|lesson → project|system|concept  (this idea applies here)
- conflicts_with — any → any  (these two things are in tension; symmetric)
- runs_on      — project|system → system  (runs/deploys on this infrastructure)
- depends_on   — project|system → project|system  (hard build/runtime dependency)
- reinforces   — event|lesson → concept  (this event/lesson reinforces the concept)
- mentioned_in — any → event  (this node was discussed in this event/session)
- supersedes   — any → any  (A supersedes B — A replaces B in the graph's evolution; directional)
`.trim();

export const QUALITY_RULES = `
EXTRACTION RULES:
1. Extract ONLY durable, recurring facts — preferences, lessons, long-term relationships, architectural decisions.
2. DO NOT extract one-off technical details: specific file paths, port numbers, version strings, error messages, temporary workarounds.
3. DO NOT invent connections not evidenced in the transcript.
4. DO NOT create duplicate nodes for ids already in existingNodeIds — reference those ids directly in candidateRelations.
5. Assign confidence 0.0–1.0 based on explicitness: explicit statement = 0.9+, implied = 0.5–0.8, speculation = <0.5.
6. Write reasoning as a single concise sentence explaining the evidence from the transcript.
7. All ids must be lowercase-kebab-case (e.g. "typescript-strict-mode", "denis-blashchytsia").
8. Aim for quality over quantity — 3 high-confidence candidates beat 15 guesses.
`.trim();

// ---------------------------------------------------------------------------
// Build the full system prompt
// ---------------------------------------------------------------------------

export function buildSystemPrompt(): string {
  return `You are a knowledge graph extraction assistant for the Litopys system.
Your task is to read an AI session transcript and extract structured knowledge candidates.

${NODE_TYPES_DOC}

${RELATION_TYPES_DOC}

${QUALITY_RULES}

OUTPUT FORMAT — respond with a single valid JSON object:
{
  "candidateNodes": [
    {
      "id": "lowercase-kebab-case-id",
      "type": "person|project|system|concept|event|lesson",
      "summary": "Short human-readable description (max 200 chars)",
      "aliases": ["optional", "alternative names"],
      "tags": ["optional", "tags"],
      "body": "Optional markdown with additional context",
      "confidence": 0.85,
      "reasoning": "Single sentence explaining evidence from transcript",
      "sourceSessionId": "<provided session id>"
    }
  ],
  "candidateRelations": [
    {
      "type": "uses",
      "sourceId": "source-node-id",
      "targetId": "target-node-id",
      "confidence": 0.8,
      "reasoning": "Single sentence explaining evidence from transcript",
      "sourceSessionId": "<provided session id>"
    }
  ]
}

Return only the JSON object. No markdown fences, no commentary.`;
}

// ---------------------------------------------------------------------------
// Build the user prompt for a given extraction input
// ---------------------------------------------------------------------------

export function buildUserPrompt(input: ExtractorInput, sessionId: string): string {
  const maxCandidates = input.maxCandidates ?? 20;
  const existingIdsSection =
    input.existingNodeIds.length > 0
      ? `\nEXISTING NODE IDS (reuse these in relations, do not create duplicates):\n${input.existingNodeIds.join(", ")}\n`
      : "\nEXISTING NODE IDS: none\n";

  return `SESSION ID: ${sessionId}
MAX CANDIDATES: ${maxCandidates} nodes total${existingIdsSection}
TRANSCRIPT:
---
${input.transcript}
---

Extract knowledge candidates from this transcript following the rules above. Use sourceSessionId = "${sessionId}" for all candidates.`;
}
