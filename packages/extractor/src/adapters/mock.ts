import type { NodeType, RelationName } from "@litopys/core";
import type {
  CandidateNode,
  CandidateRelation,
  CompleteInput,
  CompleteOutput,
  ExtractorAdapter,
  ExtractorInput,
  ExtractorOutput,
} from "./types.ts";
import { AdapterCompleteError } from "./types.ts";

// ---------------------------------------------------------------------------
// MockAdapter
// ---------------------------------------------------------------------------
//
// Deterministic, zero-network extractor used by the benchmark harness and by
// any test that wants the extraction pipeline to run without an LLM.
//
// Recognised line forms (one per match, scanned across the whole transcript):
//
//   Person:  <Display Name>, <freeform description>
//   Project: <kebab-id>, <freeform description>
//   System:  <kebab-id>, <freeform description>
//   Concept: <kebab-id>, <freeform description>
//   Lesson:  <kebab-id>, <freeform description>
//   Event:   <kebab-id>, <freeform description>
//
// People get their id auto-derived from the display name; everything else
// expects a kebab-case identifier directly so dataset authors retain control.
//
// Relations are extracted from the simple verb forms
//   <kebab-a> owns <kebab-b>
//   <kebab-a> uses <kebab-b>
//   <kebab-a> depends on <kebab-b>
//
// The point is not linguistic coverage — it's that the same transcript always
// produces the same nodes, so benchmark numbers are reproducible without
// touching a real LLM.
// ---------------------------------------------------------------------------

// Each pattern matches "<Type>: <name>, <description>" anywhere in the text.
// The description ends at the next sentence boundary (./!/?/newline) followed
// by whitespace, or at end of input. We don't use ^/$ anchors because real
// transcripts wrap declarations inside richer prose ("[user] Person: …").
const TYPE_PATTERNS: Array<{ regex: RegExp; type: NodeType }> = [
  { regex: /\bPerson:\s*([^,\n.!?]+?)(?:,\s*([^\n.!?]+))?(?=[.!?\n]|$)/gi, type: "person" },
  { regex: /\bProject:\s*([^,\n.!?]+?)(?:,\s*([^\n.!?]+))?(?=[.!?\n]|$)/gi, type: "project" },
  { regex: /\bSystem:\s*([^,\n.!?]+?)(?:,\s*([^\n.!?]+))?(?=[.!?\n]|$)/gi, type: "system" },
  { regex: /\bConcept:\s*([^,\n.!?]+?)(?:,\s*([^\n.!?]+))?(?=[.!?\n]|$)/gi, type: "concept" },
  { regex: /\bLesson:\s*([^,\n.!?]+?)(?:,\s*([^\n.!?]+))?(?=[.!?\n]|$)/gi, type: "lesson" },
  { regex: /\bEvent:\s*([^,\n.!?]+?)(?:,\s*([^\n.!?]+))?(?=[.!?\n]|$)/gi, type: "event" },
];

const KEBAB = "[a-z0-9]+(?:-[a-z0-9]+)*";
const RELATION_PATTERNS: Array<{ regex: RegExp; type: RelationName }> = [
  { regex: new RegExp(`(${KEBAB})\\s+owns\\s+(${KEBAB})`, "gi"), type: "owns" },
  { regex: new RegExp(`(${KEBAB})\\s+uses\\s+(${KEBAB})`, "gi"), type: "uses" },
  { regex: new RegExp(`(${KEBAB})\\s+depends\\s+on\\s+(${KEBAB})`, "gi"), type: "depends_on" },
];

export interface MockAdapterOptions {
  /** Override the model label reported in usage. Default: "mock-v1". */
  model?: string;
  /**
   * Queued responses for `complete()`. Each call dequeues the next entry;
   * once exhausted the last entry is repeated on every subsequent call.
   */
  completions?: string[];
  /**
   * When set, every `complete()` call throws this error instead of returning
   * a queued response. Simulates an API/transport failure for testing the
   * circuit-breaker and non-marking behavior in runEpisodesCatchup.
   */
  failWith?: Error;
}

export class MockAdapter implements ExtractorAdapter {
  readonly name = "mock";
  readonly model: string;

  /** Number of times `complete()` has been called. */
  completeCalls = 0;

  private readonly completionQueue: string[];
  private completionIndex = 0;
  private readonly failWith: Error | undefined;

  constructor(opts: MockAdapterOptions = {}) {
    this.model = opts.model ?? "mock-v1";
    this.completionQueue = opts.completions ?? ['{"groups":[]}'];
    this.failWith = opts.failWith;
  }

  async extract(input: ExtractorInput): Promise<ExtractorOutput> {
    const sessionId = `session-${Date.now()}`;
    const nodes = extractCandidateNodes(input.transcript, sessionId);
    const existing = new Set(input.existingNodeIds);
    const knownIds = new Set<string>([...existing]);
    const filteredNodes: CandidateNode[] = [];
    for (const n of nodes) {
      if (knownIds.has(n.id)) continue;
      filteredNodes.push(n);
      knownIds.add(n.id);
    }
    const relations = extractCandidateRelations(input.transcript, knownIds, sessionId);

    const max = input.maxCandidates ?? 20;
    return {
      candidateNodes: filteredNodes.slice(0, max),
      candidateRelations: relations,
      usage: { inputTokens: 0, outputTokens: 0 },
      modelUsed: this.model,
    };
  }

  async complete(input: CompleteInput): Promise<CompleteOutput> {
    this.completeCalls += 1;
    if (this.failWith !== undefined) {
      throw new AdapterCompleteError(this.failWith.message, this.failWith);
    }
    const text = this.completionQueue[this.completionIndex] ?? "";
    if (this.completionIndex < this.completionQueue.length - 1) {
      this.completionIndex += 1;
    }
    return {
      text,
      usage: {
        inputTokens: input.prompt.length,
        outputTokens: text.length,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function toKebabId(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

export function extractCandidateNodes(transcript: string, sessionId: string): CandidateNode[] {
  const seen = new Set<string>();
  const out: CandidateNode[] = [];
  for (const { regex, type } of TYPE_PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null = regex.exec(transcript);
    while (m !== null) {
      const nameRaw = (m[1] ?? "").trim();
      const description = (m[2] ?? "").trim();
      if (nameRaw.length === 0) {
        m = regex.exec(transcript);
        continue;
      }
      const id = toKebabId(nameRaw);
      if (id.length === 0 || seen.has(id)) {
        m = regex.exec(transcript);
        continue;
      }
      seen.add(id);
      const summary = description.length > 0 ? `${nameRaw} — ${description}` : nameRaw;
      const aliases = type === "person" && nameRaw !== id ? [nameRaw] : undefined;
      const candidate: CandidateNode = {
        id,
        type,
        summary: summary.slice(0, 200),
        confidence: 0.9,
        reasoning: `mock extractor: ${type} pattern matched`,
        sourceSessionId: sessionId,
        body: description.length > 0 ? description : undefined,
      };
      if (aliases) candidate.aliases = aliases;
      out.push(candidate);
      m = regex.exec(transcript);
    }
  }
  return out;
}

export function extractCandidateRelations(
  transcript: string,
  knownIds: Set<string>,
  sessionId: string,
): CandidateRelation[] {
  const out: CandidateRelation[] = [];
  const dedupe = new Set<string>();
  for (const { regex, type } of RELATION_PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null = regex.exec(transcript);
    while (m !== null) {
      const sourceId = (m[1] ?? "").toLowerCase();
      const targetId = (m[2] ?? "").toLowerCase();
      if (sourceId && targetId && knownIds.has(sourceId) && knownIds.has(targetId)) {
        const key = `${type}|${sourceId}|${targetId}`;
        if (!dedupe.has(key)) {
          dedupe.add(key);
          out.push({
            type,
            sourceId,
            targetId,
            confidence: 0.8,
            reasoning: `mock extractor: "${type}" verb pattern`,
            sourceSessionId: sessionId,
          });
        }
      }
      m = regex.exec(transcript);
    }
  }
  return out;
}
