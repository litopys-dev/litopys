/**
 * Daemon state — tracks per-file byte offsets for incremental ingestion.
 * State is persisted atomically to ~/.litopys/daemon-state.json.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileState {
  /** Byte offset — next read starts here. */
  byteOffset: number;
  /** mtime at last read, ISO string. Used to detect rotation / truncation. */
  mtime: string;
  /** Adapter name used to parse this file. */
  adapter: string;
}

export interface DaemonState {
  version: 1;
  /** Last successful tick timestamp, ISO string. */
  lastTick?: string;
  /** Per-file state keyed by absolute path. */
  sources: Record<string, FileState>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function defaultStatePath(): string {
  const dir = process.env.LITOPYS_DAEMON_STATE
    ? path.dirname(process.env.LITOPYS_DAEMON_STATE)
    : path.join(os.homedir(), ".litopys");
  const file = process.env.LITOPYS_DAEMON_STATE ?? path.join(dir, "daemon-state.json");
  return file;
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/** Load state from disk. Returns a fresh empty state if file does not exist. */
export async function loadState(statePath: string): Promise<DaemonState> {
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (isValidState(parsed)) return parsed;
    // Unknown format — reset
    return emptyState();
  } catch (err: unknown) {
    // ENOENT is expected on first run; other errors we surface as empty state.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      process.stderr.write(`[litopys/daemon] Could not read state file (${String(err)}), starting fresh\n`);
    }
    return emptyState();
  }
}

/**
 * Atomically write state to disk:
 * write to a .tmp file, then rename (POSIX atomic on same filesystem).
 */
export async function saveState(statePath: string, state: DaemonState): Promise<void> {
  const dir = path.dirname(statePath);
  await fs.mkdir(dir, { recursive: true });

  const tmp = `${statePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await fs.rename(tmp, statePath);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyState(): DaemonState {
  return { version: 1, sources: {} };
}

function isValidState(value: unknown): value is DaemonState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v["version"] === 1 && typeof v["sources"] === "object" && v["sources"] !== null;
}
