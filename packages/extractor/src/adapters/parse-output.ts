/**
 * Shared parsing of an LLM extraction response.
 *
 * Every adapter used to carry its own copy of this logic, and every copy was
 * all-or-nothing: one bad enum anywhere in the payload failed `LLMOutputSchema`
 * and the whole batch — including perfectly good candidates — was discarded.
 * Small and mid-size models miss enum spellings routinely (`learns_from` for
 * `learned_from`, `service` for `system`), so that design threw away most of
 * what the model produced.
 *
 * Two changes fix it:
 *   1. near-miss enum values are normalized before validation, and
 *   2. candidates and relations are validated one by one, so a malformed item
 *      costs only itself.
 *
 * Inverse relation names (`owned_by` for `owns`) are deliberately NOT mapped:
 * they name the same edge in the opposite direction, and silently flipping it
 * would record a fact the model never asserted.
 */

import { NodeType, RelationName } from "@litopys/core";
import { stripCodeFences } from "../llm-utils.ts";
import {
  type CandidateNode,
  CandidateNodeSchema,
  type CandidateRelation,
  CandidateRelationSchema,
  type ExtractorOutput,
  normalizeLLMOutput,
} from "./types.ts";

const NODE_TYPES = NodeType.options as readonly string[];
const RELATION_NAMES = RelationName.options as readonly string[];

/**
 * Semantic synonyms observed from real providers. Kept deliberately short: a
 * wrong mapping invents a fact, whereas an unmapped value now costs only the
 * one item that carried it.
 */
const NODE_TYPE_ALIASES: Record<string, string> = {
  service: "system",
  server: "system",
  tool: "system",
  software: "system",
  database: "system",
  application: "project",
  app: "project",
  repository: "project",
  repo: "project",
  human: "person",
  user: "person",
  insight: "lesson",
  learning: "lesson",
  pattern: "concept",
  practice: "concept",
  principle: "concept",
  incident: "event",
  decision: "event",
};

const RELATION_ALIASES: Record<string, string> = {
  learns_from: "learned_from",
  learnt_from: "learned_from",
  learned: "learned_from",
  own: "owns",
  prefer: "prefers",
  use: "uses",
  applies: "applies_to",
  apply_to: "applies_to",
  depends: "depends_on",
  depend_on: "depends_on",
  runs: "runs_on",
  run_on: "runs_on",
  mentioned: "mentioned_in",
  mention_in: "mentioned_in",
  conflicts: "conflicts_with",
  conflict_with: "conflicts_with",
  supersede: "supersedes",
  reinforce: "reinforces",
};

/** Levenshtein distance, iterative two-row variant. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        (row[j - 1] as number) + 1,
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    prev = row;
  }
  return prev[b.length] as number;
}

/**
 * Snap a value onto an enum: exact match, then explicit alias, then a unique
 * typo within edit distance 2. Ambiguous fuzzy matches are left alone — better
 * to drop one item than to guess between two relations.
 */
function snapToEnum(
  raw: unknown,
  canonical: readonly string[],
  aliases: Record<string, string>,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (canonical.includes(key)) return key;
  const alias = aliases[key];
  if (alias !== undefined) return alias;

  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tied = false;
  for (const option of canonical) {
    const distance = editDistance(key, option);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }
  if (best !== undefined && bestDistance <= 2 && !tied) return best;
  return undefined;
}

export function normalizeNodeType(raw: unknown): string | undefined {
  return snapToEnum(raw, NODE_TYPES, NODE_TYPE_ALIASES);
}

export function normalizeRelationName(raw: unknown): string | undefined {
  return snapToEnum(raw, RELATION_NAMES, RELATION_ALIASES);
}

/**
 * Rewrite `type` fields onto their canonical enum values. Items whose type
 * cannot be resolved are passed through untouched so per-item validation
 * reports them as the malformed items they are.
 */
export function normalizeEnums(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== "object") return parsed;
  const obj = parsed as Record<string, unknown>;

  const fix = (item: unknown, resolve: (raw: unknown) => string | undefined): unknown => {
    if (item === null || typeof item !== "object") return item;
    const rec = { ...(item as Record<string, unknown>) };
    const snapped = resolve(rec.type);
    if (snapped !== undefined) rec.type = snapped;
    return rec;
  };

  return {
    ...obj,
    candidateNodes: Array.isArray(obj.candidateNodes)
      ? obj.candidateNodes.map((n) => fix(n, normalizeNodeType))
      : obj.candidateNodes,
    candidateRelations: Array.isArray(obj.candidateRelations)
      ? obj.candidateRelations.map((r) => fix(r, normalizeRelationName))
      : obj.candidateRelations,
  };
}

export interface ParseExtractorOutputOptions {
  rawText: string;
  modelUsed: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  /** Prefix for log lines, e.g. "Ollama" — identifies the provider. */
  providerLabel: string;
}

/**
 * Turn a raw LLM response into an ExtractorOutput, keeping every item that
 * validates and reporting the rest.
 */
export function parseExtractorOutput(opts: ParseExtractorOutputOptions): ExtractorOutput {
  const usage = { inputTokens: opts.inputTokens, outputTokens: opts.outputTokens };
  const cleaned = stripCodeFences(opts.rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    process.stderr.write(
      `[litopys/extractor] ${opts.providerLabel}: response is not JSON: ${opts.rawText.slice(0, 200)}\n`,
    );
    return {
      candidateNodes: [],
      candidateRelations: [],
      usage,
      modelUsed: opts.modelUsed,
      failure: { kind: "unparseable", message: "response is not JSON" },
    };
  }

  const normalized = normalizeEnums(normalizeLLMOutput(parsed, opts.sessionId)) as Record<
    string,
    unknown
  >;

  const rawNodes = Array.isArray(normalized.candidateNodes) ? normalized.candidateNodes : [];
  const rawRelations = Array.isArray(normalized.candidateRelations)
    ? normalized.candidateRelations
    : [];

  const candidateNodes: CandidateNode[] = [];
  const candidateRelations: CandidateRelation[] = [];
  const dropped: string[] = [];

  for (const raw of rawNodes) {
    const result = CandidateNodeSchema.safeParse(raw);
    if (result.success) {
      candidateNodes.push(result.data);
    } else {
      const id = (raw as { id?: unknown })?.id;
      dropped.push(`node ${typeof id === "string" ? id : "<no id>"}: ${issueSummary(result)}`);
    }
  }

  for (const raw of rawRelations) {
    const result = CandidateRelationSchema.safeParse(raw);
    if (result.success) {
      candidateRelations.push(result.data);
    } else {
      const rel = raw as { type?: unknown; sourceId?: unknown; targetId?: unknown };
      dropped.push(
        `relation ${String(rel?.type)} ${String(rel?.sourceId)}→${String(rel?.targetId)}: ${issueSummary(result)}`,
      );
    }
  }

  if (dropped.length > 0) {
    process.stderr.write(
      `[litopys/extractor] ${opts.providerLabel}: dropped ${dropped.length} malformed item(s), ` +
        `kept ${candidateNodes.length} node(s) and ${candidateRelations.length} relation(s): ${dropped.join("; ")}\n`,
    );
  }

  // Nothing survived and the payload did carry items — the response was
  // structurally wrong, not merely empty. Say so, so the caller does not treat
  // it as "this transcript held no facts".
  if (
    candidateNodes.length === 0 &&
    candidateRelations.length === 0 &&
    rawNodes.length + rawRelations.length > 0
  ) {
    return {
      candidateNodes,
      candidateRelations,
      usage,
      modelUsed: opts.modelUsed,
      failure: {
        kind: "unparseable",
        message: `every one of ${rawNodes.length + rawRelations.length} item(s) failed validation`,
      },
    };
  }

  return { candidateNodes, candidateRelations, usage, modelUsed: opts.modelUsed };
}

function issueSummary(result: { success: false; error: { issues: Array<unknown> } }): string {
  const issues = result.error.issues as Array<{ path?: unknown[]; message?: string }>;
  return issues
    .slice(0, 2)
    .map((i) => `${(i.path ?? []).join(".")} ${i.message ?? ""}`.trim())
    .join(", ");
}
