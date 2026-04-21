export * from "./schema/index.ts";
export { loadGraph, type LoadResult, type GraphError } from "./graph/loader.ts";
export { resolveGraph, type ResolvedGraph, type Edge } from "./graph/resolver.ts";
export { writeNode } from "./graph/writer.ts";
export { detectConflicts, type Conflict } from "./graph/conflicts.ts";
export {
  scoreSimilarity,
  findSimilar,
  levenshtein,
  tagJaccard,
  aliasOverlap,
  idEditSimilarity,
  type SimilarityResult,
  type SimilarityReason,
  type FindSimilarOptions,
} from "./graph/similarity.ts";
