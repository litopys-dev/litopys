/**
 * Daemon source configuration — which files to watch and with which adapter.
 * Default: Claude Code session JSONL files.
 * Override via LITOPYS_DAEMON_SOURCES env var (JSON array).
 */

import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceConfig {
  /** Adapter name, e.g. "claude-code", "jsonl", "text". */
  adapter: string;
  /** Glob pattern — may contain ~. */
  glob: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SOURCES: SourceConfig[] = [
  {
    adapter: "claude-code",
    glob: "~/.claude/projects/*/*.jsonl",
  },
  {
    adapter: "claude-code",
    glob: "~/.claude/projects/*/subagents/*.jsonl",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load source configs from LITOPYS_DAEMON_SOURCES env var, or return defaults.
 * LITOPYS_DAEMON_SOURCES must be a JSON array of {adapter, glob} objects.
 */
export function loadSourceConfigs(): SourceConfig[] {
  const raw = process.env.LITOPYS_DAEMON_SOURCES;
  if (!raw) return DEFAULT_SOURCES;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      process.stderr.write(
        "[litopys/daemon] LITOPYS_DAEMON_SOURCES must be a JSON array, using defaults\n",
      );
      return DEFAULT_SOURCES;
    }

    const valid: SourceConfig[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).adapter === "string" &&
        typeof (item as Record<string, unknown>).glob === "string"
      ) {
        valid.push({
          adapter: (item as Record<string, unknown>).adapter as string,
          glob: (item as Record<string, unknown>).glob as string,
        });
      }
    }

    if (valid.length === 0) {
      process.stderr.write(
        "[litopys/daemon] LITOPYS_DAEMON_SOURCES had no valid entries, using defaults\n",
      );
      return DEFAULT_SOURCES;
    }

    return valid;
  } catch {
    process.stderr.write(
      "[litopys/daemon] Could not parse LITOPYS_DAEMON_SOURCES, using defaults\n",
    );
    return DEFAULT_SOURCES;
  }
}

/** Expand ~ to the user's home directory in a glob pattern. */
export function expandTilde(pattern: string): string {
  if (!pattern.startsWith("~")) return pattern;
  return path.join(os.homedir(), pattern.slice(1));
}
