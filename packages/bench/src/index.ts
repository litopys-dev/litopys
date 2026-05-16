export const PACKAGE_NAME = "@litopys/bench";
export const VERSION = "0.1.0";

export { recallAtK, precisionAtK, mean } from "./scoring.ts";
export {
  parseDataset,
  loadDataset,
  loadDatasetFile,
  resolveDatasetSpec,
  builtinDatasetPath,
  isBuiltinDataset,
  BUILTIN_DATASETS,
  BenchDatasetSchema,
  BenchSessionSchema,
  BenchQuestionSchema,
  BenchMessageSchema,
} from "./dataset.ts";
export type {
  BenchDataset,
  BenchSession,
  BenchQuestion,
  BenchMessage,
  BuiltinDataset,
} from "./dataset.ts";
export {
  runBenchmark,
  formatReportMarkdown,
  createIsolatedGraphDir,
} from "./harness.ts";
export type {
  HarnessOptions,
  BenchReport,
  PerQuestionResult,
} from "./harness.ts";
