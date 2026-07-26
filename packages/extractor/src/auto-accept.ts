/**
 * Auto-accept high-confidence quarantine candidates.
 *
 * The human-in-the-loop review step is the bottleneck of the whole memory
 * pipeline: extraction runs on a timer and never tires, while manual acceptance
 * depends on someone opening the queue. Left alone, the queue only grows and
 * the graph starves. This pass closes the loop for the candidates that are safe
 * to land without a human, and leaves everything else in quarantine.
 *
 * A candidate is landed only when it clears every guard:
 *   1. it validates against `CandidateNodeSchema`,
 *   2. its confidence is at or above `minConfidence`,
 *   3. its id/alias does not already exist in the graph,
 *   4. it is not a near-duplicate of an existing node (id/alias/tag similarity),
 *   5. it does not admit, in its own body or reasoning, that it was inferred
 *      rather than stated — the marker that betrays fabricated people and
 *      systems the transcript never actually mentioned.
 *
 * Relations are applied under the same confidence bar, plus:
 *   - `supersedes` is never auto-applied (it has bi-temporal side effects —
 *     tombstoning the superseded node — that need a human),
 *   - both endpoints must exist after the promotion pass, which is why
 *     relations are applied in a second pass and are order-independent,
 *   - the pair of endpoint types must satisfy `RELATION_CONSTRAINTS`.
 *
 * `dryRun: true` returns the identical plan without touching graph or
 * quarantine, so an operator can see what would land before it lands.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  RELATION_CONSTRAINTS,
  loadGraph,
  scoreSimilarity,
  withGraphLock,
  writeNode,
} from "@litopys/core";
import type { AnyNode, RelationName } from "@litopys/core";
import {
  type CandidateNode,
  CandidateNodeSchema,
  type CandidateRelation,
} from "./adapters/types.ts";
import { isMergeProposalContent } from "./merge-proposal.ts";
import {
  promoteCandidate,
  readQuarantineFile,
  rejectCandidate,
  rewriteQuarantineFile,
} from "./quarantine.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoAcceptOptions {
  quarantineDir: string;
  graphPath: string;
  /** Inclusive lower bound on candidate confidence. 0..1. */
  minConfidence: number;
  dryRun: boolean;
  /**
   * Skip candidates whose body/reasoning admits the fact was inferred rather
   * than stated. Default true.
   */
  guardSpeculation?: boolean;
  /**
   * Similarity score at or above which a candidate counts as a near-duplicate
   * of an existing node and is left for human review. Default 0.5.
   */
  nearDuplicateScore?: number;
  /**
   * Clear out queue entries that no review can ever act on. Default true.
   *
   * Two kinds qualify: a candidate whose id already exists in the graph (there
   * is nothing left to create — accepting it is a no-op), and a relation whose
   * endpoints exist neither in the graph nor among the file's own candidates
   * (it can never be applied). Both are logged to rejected.jsonl rather than
   * deleted silently. Without this the queue never shrinks: the unactionable
   * entries pin their files open forever.
   */
  pruneUnactionable?: boolean;
}

export type AutoAcceptSkipReason =
  | "invalid-schema"
  | "below-threshold"
  | "already-in-graph"
  | "duplicate-in-batch"
  | "near-duplicate"
  | "speculative";

export interface AutoAcceptedItem {
  filePath: string;
  candidateId: string;
  type: string;
  confidence: number;
  /** Relations landed with this candidate as their source. */
  relationsApplied: number;
}

export interface AutoAcceptSkip {
  filePath: string;
  candidateId: string;
  reason: AutoAcceptSkipReason;
  confidence?: number;
  /** For near-duplicate: the existing node it collided with. */
  collidesWith?: string;
}

export interface AutoAcceptError {
  filePath: string;
  candidateId: string;
  message: string;
}

export interface AutoAcceptResult {
  accepted: AutoAcceptedItem[];
  skipped: AutoAcceptSkip[];
  errors: AutoAcceptError[];
  /** Quarantine candidate files inspected (merge proposals are not counted). */
  filesScanned: number;
  candidatesScanned: number;
  /** Files deleted because nothing was left to review. */
  filesRemoved: number;
  /** Relations landed in the graph. */
  relationsApplied: number;
  /** Relations left in quarantine for a human (supersedes, missing endpoint). */
  relationsDeferred: number;
  /** Relations dropped as structurally impossible (constraint violation). */
  relationsInvalid: number;
  /** Relations dropped because neither endpoint exists or ever will. */
  relationsDangling: number;
  /** Candidates rejected as already-created (logged to rejected.jsonl). */
  pruned: number;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Phrases in which the extractor itself concedes the fact was not stated.
 * Deliberately narrow: these are admissions of inference, not ordinary hedging
 * ("возможно", "may be") which appears in plenty of legitimate bodies.
 */
const SPECULATION_MARKERS: RegExp[] = [
  /not explicitly mentioned/i,
  /not explicitly stated/i,
  /inferred (?:through|from) context/i,
  /прямо не упомина/i,
  /не упомина[а-яё]*\s+прямо/i,
  /не упомянут/i,
  /выведено из контекста/i,
  /предположительно/i,
];

export function looksSpeculative(candidate: CandidateNode): boolean {
  const haystack = `${candidate.body ?? ""}\n${candidate.reasoning}`;
  return SPECULATION_MARKERS.some((re) => re.test(haystack));
}

/** Candidate → the minimal node shape the similarity scorer needs. */
function asNodeLike(candidate: CandidateNode): AnyNode {
  return {
    id: candidate.id,
    type: candidate.type,
    summary: candidate.summary,
    updated: new Date().toISOString().slice(0, 10),
    confidence: candidate.confidence,
    ...(candidate.aliases ? { aliases: candidate.aliases } : {}),
    ...(candidate.tags ? { tags: candidate.tags } : {}),
  } as AnyNode;
}

function relationAllowed(
  type: RelationName,
  sourceType: AnyNode["type"],
  targetType: AnyNode["type"],
): boolean {
  const constraint = RELATION_CONSTRAINTS[type];
  if (!constraint) return false;
  return constraint.sources.includes(sourceType) && constraint.targets.includes(targetType);
}

// ---------------------------------------------------------------------------
// Main pass
// ---------------------------------------------------------------------------

export async function autoAcceptCandidates(opts: AutoAcceptOptions): Promise<AutoAcceptResult> {
  if (!Number.isFinite(opts.minConfidence) || opts.minConfidence < 0 || opts.minConfidence > 1) {
    throw new Error(`minConfidence must be 0..1, got ${opts.minConfidence}`);
  }

  const guardSpeculation = opts.guardSpeculation ?? true;
  const nearDuplicateScore = opts.nearDuplicateScore ?? 0.5;
  const pruneUnactionable = opts.pruneUnactionable ?? true;

  const result: AutoAcceptResult = {
    accepted: [],
    skipped: [],
    errors: [],
    filesScanned: 0,
    candidatesScanned: 0,
    filesRemoved: 0,
    relationsApplied: 0,
    relationsDeferred: 0,
    relationsInvalid: 0,
    relationsDangling: 0,
    pruned: 0,
  };

  let entries: string[];
  try {
    entries = await fs.readdir(opts.quarantineDir);
  } catch {
    return result;
  }

  // Stable order: oldest quarantine file first (names are ISO timestamps), so a
  // candidate that several sessions proposed lands from its earliest mention.
  entries.sort();

  // Ids and node-likes landed earlier in THIS pass. Two quarantine files
  // routinely propose the same id under different types. Without this, a dry-run
  // reports both as acceptable, and two candidates sharing an id inside one file
  // would both be written — one per type directory, producing an id collision
  // the loader cannot resolve.
  const batch: BatchState = { ids: new Set<string>(), nodes: [] };

  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const filePath = path.join(opts.quarantineDir, name);

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    // Merge proposals live in the same directory and are handled by autoMergeProposals.
    if (isMergeProposalContent(raw)) continue;

    try {
      await processFile(
        filePath,
        opts,
        { guardSpeculation, nearDuplicateScore, pruneUnactionable },
        result,
        batch,
      );
    } catch (err) {
      result.errors.push({ filePath, candidateId: "(file)", message: String(err) });
    }
  }

  return result;
}

interface Tuning {
  guardSpeculation: boolean;
  nearDuplicateScore: number;
  pruneUnactionable: boolean;
}

/** Ids and node-likes already landed by this pass (see comment at call site). */
interface BatchState {
  ids: Set<string>;
  nodes: AnyNode[];
}

async function processFile(
  filePath: string,
  opts: AutoAcceptOptions,
  tuning: Tuning,
  result: AutoAcceptResult,
  batch: BatchState,
): Promise<void> {
  const qFile = await readQuarantineFile(filePath);
  result.filesScanned++;
  result.candidatesScanned += qFile.candidates.length;

  const graph = await loadGraph(opts.graphPath).catch(() => ({ nodes: new Map() }) as never);
  const existing = new Set<string>();
  for (const node of graph.nodes.values()) {
    existing.add(node.id.toLowerCase());
    for (const alias of node.aliases ?? []) existing.add(alias.toLowerCase());
  }

  const acceptable: CandidateNode[] = [];
  /** Already in the graph — nothing to create, so no review can act on them. */
  const unactionable: CandidateNode[] = [];

  for (const candidate of qFile.candidates) {
    const parsed = CandidateNodeSchema.safeParse(candidate);
    if (!parsed.success) {
      result.skipped.push({
        filePath,
        candidateId: String((candidate as { id?: unknown }).id ?? "(no id)"),
        reason: "invalid-schema",
      });
      continue;
    }

    if (candidate.confidence < opts.minConfidence) {
      result.skipped.push({
        filePath,
        candidateId: candidate.id,
        reason: "below-threshold",
        confidence: candidate.confidence,
      });
      continue;
    }

    if (
      existing.has(candidate.id.toLowerCase()) ||
      (candidate.aliases ?? []).some((a) => existing.has(a.toLowerCase()))
    ) {
      result.skipped.push({ filePath, candidateId: candidate.id, reason: "already-in-graph" });
      unactionable.push(candidate);
      continue;
    }

    const batchKeys = [candidate.id, ...(candidate.aliases ?? [])].map((s) => s.toLowerCase());
    if (batchKeys.some((k) => batch.ids.has(k))) {
      result.skipped.push({
        filePath,
        candidateId: candidate.id,
        reason: "duplicate-in-batch",
        confidence: candidate.confidence,
      });
      continue;
    }

    if (tuning.guardSpeculation && looksSpeculative(candidate)) {
      result.skipped.push({
        filePath,
        candidateId: candidate.id,
        reason: "speculative",
        confidence: candidate.confidence,
      });
      continue;
    }

    const nodeLike = asNodeLike(candidate);
    let collision: string | undefined;
    for (const node of [...graph.nodes.values(), ...batch.nodes]) {
      if (scoreSimilarity(nodeLike, node).score >= tuning.nearDuplicateScore) {
        collision = node.id;
        break;
      }
    }
    if (collision !== undefined) {
      result.skipped.push({
        filePath,
        candidateId: candidate.id,
        reason: "near-duplicate",
        confidence: candidate.confidence,
        collidesWith: collision,
      });
      continue;
    }

    acceptable.push(candidate);
    batch.ids.add(candidate.id.toLowerCase());
    for (const alias of candidate.aliases ?? []) batch.ids.add(alias.toLowerCase());
    batch.nodes.push(nodeLike);
  }

  if (opts.dryRun) {
    for (const candidate of acceptable) {
      result.accepted.push({
        filePath,
        candidateId: candidate.id,
        type: candidate.type,
        confidence: candidate.confidence,
        relationsApplied: 0,
      });
    }
    if (tuning.pruneUnactionable) {
      result.pruned += unactionable.length;
    }
    for (const rel of qFile.relations) {
      if (rel.type === "supersedes") result.relationsDeferred++;
    }
    return;
  }

  // Promotion pass. Indices shift as candidates leave the file, so each
  // candidate is located by id against the file's current contents.
  for (const candidate of acceptable) {
    try {
      const current = await readQuarantineFile(filePath);
      const index = current.candidates.findIndex((c) => c.id === candidate.id);
      if (index === -1) continue;
      // Relations are landed by the second pass below, which enforces the
      // constraint table and defers supersedes.
      await promoteCandidate(filePath, index, opts.graphPath, { applyRelations: false });
      result.accepted.push({
        filePath,
        candidateId: candidate.id,
        type: candidate.type,
        confidence: candidate.confidence,
        relationsApplied: 0,
      });
    } catch (err) {
      result.errors.push({ filePath, candidateId: candidate.id, message: String(err) });
    }
  }

  // Prune pass — reject candidates the graph already contains. Accepting one is
  // a no-op, so leaving it queued pins the file open for good.
  if (tuning.pruneUnactionable) {
    for (const candidate of unactionable) {
      try {
        const current = await readQuarantineFile(filePath);
        const index = current.candidates.findIndex((c) => c.id === candidate.id);
        if (index === -1) continue;
        await rejectCandidate(
          filePath,
          index,
          opts.graphPath,
          "auto-accept: node already exists in the graph",
        );
        result.pruned++;
      } catch (err) {
        result.errors.push({ filePath, candidateId: candidate.id, message: String(err) });
      }
    }
  }

  // Relation pass. Runs after every candidate is in the graph, so a relation
  // between two same-file candidates lands regardless of promotion order.
  let leftover: QuarantineLeftover;
  try {
    leftover = await readLeftover(filePath);
  } catch {
    // promoteCandidate/rejectCandidate deleted the file — nothing left to do.
    result.filesRemoved++;
    return;
  }

  const keptRelations: CandidateRelation[] = [];
  for (const rel of leftover.relations) {
    const verdict = await applyRelation(rel, opts, leftover.candidates, tuning);
    if (verdict === "applied") {
      result.relationsApplied++;
      const item = result.accepted.find(
        (a) => a.candidateId === rel.sourceId && a.filePath === filePath,
      );
      if (item) item.relationsApplied++;
    } else if (verdict === "invalid") {
      result.relationsInvalid++;
    } else if (verdict === "dangling") {
      result.relationsDangling++;
    } else {
      result.relationsDeferred++;
      keptRelations.push(rel);
    }
  }

  const removed = await rewriteQuarantineFile(
    filePath,
    leftover.candidates,
    keptRelations,
    leftover.meta,
  );
  if (removed) result.filesRemoved++;
}

interface QuarantineLeftover {
  candidates: CandidateNode[];
  relations: CandidateRelation[];
  meta: Awaited<ReturnType<typeof readQuarantineFile>>["meta"];
}

async function readLeftover(filePath: string): Promise<QuarantineLeftover> {
  const qFile = await readQuarantineFile(filePath);
  return { candidates: qFile.candidates, relations: qFile.relations, meta: qFile.meta };
}

type RelationVerdict = "applied" | "deferred" | "invalid" | "dangling";

/**
 * Land one relation if it clears every gate. Returns what happened so the
 * caller can decide whether to keep it in quarantine.
 *
 * `stillQueued` is the file's remaining candidates: a relation pointing at one
 * of them is not dangling, it is merely early — a later review may promote that
 * candidate and make the edge applicable.
 */
async function applyRelation(
  rel: CandidateRelation,
  opts: AutoAcceptOptions,
  stillQueued: CandidateNode[],
  tuning: Tuning,
): Promise<RelationVerdict> {
  // supersedes tombstones its target — never automatic.
  if (rel.type === "supersedes") return "deferred";

  return withGraphLock(opts.graphPath, async () => {
    const loaded = await loadGraph(opts.graphPath);
    const source = loaded.nodes.get(rel.sourceId);
    const target = loaded.nodes.get(rel.targetId);

    if (!source || !target) {
      if (!tuning.pruneUnactionable) return "deferred";
      const queued = new Set(stillQueued.map((c) => c.id));
      // Only one endpoint may still arrive via a queued candidate; if neither
      // endpoint exists and neither is queued, no future review can apply it.
      const recoverable =
        (!source && queued.has(rel.sourceId)) || (!target && queued.has(rel.targetId));
      return recoverable ? "deferred" : "dangling";
    }

    if (!relationAllowed(rel.type, source.type, target.type)) return "invalid";
    // Below the bar we land automatically, but structurally fine — a human may
    // still want it, so keep it queued.
    if (rel.confidence < opts.minConfidence) return "deferred";

    const already = source.rels?.[rel.type] ?? [];
    if (already.includes(rel.targetId)) return "applied";

    const rels = { ...(source.rels ?? {}) } as Record<RelationName, string[]>;
    rels[rel.type] = [...already, rel.targetId];
    await writeNode(opts.graphPath, { ...source, rels } as AnyNode);
    return "applied";
  });
}
