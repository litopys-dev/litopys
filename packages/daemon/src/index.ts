/**
 * @litopys/daemon — public API.
 */

export { loadState, saveState, defaultStatePath } from "./state.ts";
export type { DaemonState, FileState } from "./state.ts";

export { loadSourceConfigs, expandTilde } from "./config.ts";
export type { SourceConfig } from "./config.ts";

export { runTick } from "./tick.ts";
export type { TickOptions, TickResult, FileTickResult } from "./tick.ts";
