/**
 * @litopys/daemon — public API.
 */

export { loadState, saveState, defaultStatePath } from "./state.ts";
export type { DaemonState, FileState } from "./state.ts";

export { loadSourceConfigs, expandTilde } from "./config.ts";
export type { SourceConfig } from "./config.ts";

export { runTick, runEpisodesCatchup } from "./tick.ts";
export type {
  TickOptions,
  TickResult,
  FileTickResult,
  EpisodesCatchupOptions,
  EpisodesCatchupResult,
} from "./tick.ts";
