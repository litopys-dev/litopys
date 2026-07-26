export const PACKAGE_NAME = "@litopys/extractor";
export const VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export { createAdapter } from "./adapters/factory.ts";
export type { AdapterName, AdapterOptions } from "./adapters/factory.ts";
export { MockAdapter } from "./adapters/mock.ts";
export type { MockAdapterOptions } from "./adapters/mock.ts";

export type {
  ExtractorAdapter,
  ExtractorInput,
  ExtractorOutput,
  ExtractorFailure,
  CandidateNode,
  CandidateRelation,
} from "./adapters/types.ts";
export {
  AdapterCompleteError,
  CandidateNodeSchema,
  CandidateRelationSchema,
  LLMOutputSchema,
} from "./adapters/types.ts";
export {
  normalizeEnums,
  normalizeNodeType,
  normalizeRelationName,
  parseExtractorOutput,
} from "./adapters/parse-output.ts";
export type { ParseExtractorOutputOptions } from "./adapters/parse-output.ts";

export { buildSystemPrompt, buildUserPrompt } from "./prompt.ts";

export {
  writeQuarantine,
  writeQuarantineTo,
  listQuarantine,
  listQuarantineFrom,
  readQuarantineFile,
  rewriteQuarantineFile,
  promoteCandidate,
  rejectCandidate,
} from "./quarantine.ts";
export type { QuarantineMeta, QuarantineFile } from "./quarantine.ts";

export { dedupCandidatesAgainstGraph } from "./dedup.ts";
export type { DedupResult } from "./dedup.ts";

export { generateDigest } from "./digest.ts";
export type { DigestOptions, DigestResult } from "./digest.ts";

export {
  proposeMerge,
  writeMergeProposal,
  parseMergeProposal,
  serializeMergeProposal,
  isMergeProposalContent,
} from "./merge-proposal.ts";
export type { MergeProposal, MergeResult, MergeConflict } from "./merge-proposal.ts";
export { acceptMergeProposal, rejectMergeProposal } from "./merge-apply.ts";
export { autoAcceptCandidates, looksSpeculative } from "./auto-accept.ts";
export type {
  AutoAcceptOptions,
  AutoAcceptResult,
  AutoAcceptedItem,
  AutoAcceptSkip,
  AutoAcceptSkipReason,
  AutoAcceptError,
} from "./auto-accept.ts";
export { autoMergeProposals, parseSimilarity } from "./auto-merge.ts";
export type {
  AutoMergeOptions,
  AutoMergeResult,
  AutoMergedItem,
  AutoMergeSkip,
  AutoMergeError,
} from "./auto-merge.ts";

// ---------------------------------------------------------------------------
// Source adapters (agent-agnostic ingestion layer — Part 6.3a)
// ---------------------------------------------------------------------------

export { selectAdapter, registeredAdapterNames } from "./sources/factory.ts";
export { TextAdapter } from "./sources/text.ts";
export { JsonlAdapter } from "./sources/jsonl.ts";
export { ClaudeCodeAdapter } from "./sources/claude-code.ts";
export type { SourceAdapter, TranscriptChunk } from "./sources/types.ts";

export { parseClaudeCodeTranscript, sessionDateFromTranscript } from "./transcript-tools.ts";
export type { ParsedTranscript, ParseOptions } from "./transcript-tools.ts";

// ---------------------------------------------------------------------------
// Episode store (Stage A / skill-detector)
// ---------------------------------------------------------------------------

export {
  EpisodeSchema,
  makeEpisodeId,
  defaultEpisodesDir,
  appendEpisodes,
  listUnclustered,
  markClustered,
} from "./episode-store.ts";
export type { Episode } from "./episode-store.ts";

// ---------------------------------------------------------------------------
// Episode extraction — Stage A LLM stage
// ---------------------------------------------------------------------------

export { extractEpisodes, EPISODE_EXTRACTION_PROMPT } from "./episodes.ts";

// ---------------------------------------------------------------------------
// SessionEnd hook — episode stage
// ---------------------------------------------------------------------------

export { runEpisodeStage } from "./session-end.ts";

// ---------------------------------------------------------------------------
// Skill-detector config
// ---------------------------------------------------------------------------

export { loadSkillConfig } from "./skill-config.ts";
export type { SkillDetectorConfig } from "./skill-config.ts";

// ---------------------------------------------------------------------------
// Stage B — episode clustering and SKILL.md drafting
// ---------------------------------------------------------------------------

export {
  clusterEpisodes,
  selectDraftable,
  draftSkill,
  normalizeSkillName,
  writeSkillDraft,
  CLUSTER_PROMPT,
  DRAFT_PROMPT,
} from "./skill-draft.ts";
export type { EpisodeGroup, SkillDraftMeta } from "./skill-draft.ts";

// ---------------------------------------------------------------------------
// Stage B — skill draft quarantine (list/promote/reject)
// ---------------------------------------------------------------------------

export {
  defaultQuarantineSkillsDir,
  listSkillDrafts,
  readSkillDraft,
  promoteSkillDraft,
  rejectSkillDraft,
} from "./skill-quarantine.ts";
export type { SkillDraftErrorCode } from "./skill-quarantine.ts";

// ---------------------------------------------------------------------------
// Stage B — skills-tick orchestration
// ---------------------------------------------------------------------------

export { runSkillsTick } from "./skills-tick.ts";
export type { SkillsTickOptions, SkillsTickResult } from "./skills-tick.ts";
