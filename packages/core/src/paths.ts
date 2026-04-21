import { homedir } from "node:os";
import * as path from "node:path";

/**
 * Resolve the canonical graph directory.
 *
 * Priority: `LITOPYS_GRAPH_PATH` env var → `~/.litopys/graph`.
 *
 * Callers must never fall back to a relative path like `./.litopys/graph` —
 * that pattern broke `litopys quarantine list` when run outside the home
 * directory and desynced the CLI from `install.sh`, which creates the
 * skeleton under `~/.litopys/graph`.
 */
export function defaultGraphPath(): string {
  const fromEnv = process.env.LITOPYS_GRAPH_PATH;
  if (fromEnv && fromEnv !== "undefined") return fromEnv;
  return path.join(homedir(), ".litopys", "graph");
}
