export * from "./schema/index.ts";
export { defaultGraphPath } from "./paths.ts";
export { loadGraph, type LoadResult, type GraphError } from "./graph/loader.ts";
export { resolveGraph, type ResolvedGraph, type Edge } from "./graph/resolver.ts";
export { writeNode, normalizeId } from "./graph/writer.ts";
export { detectConflicts, type Conflict } from "./graph/conflicts.ts";
export {
  scoreSimilarity,
  findSimilar,
  levenshtein,
  tagJaccard,
  aliasOverlap,
  idEditSimilarity,
  idSubstringContainment,
  type SimilarityResult,
  type SimilarityReason,
  type FindSimilarOptions,
} from "./graph/similarity.ts";
