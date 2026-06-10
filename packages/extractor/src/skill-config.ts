/**
 * Skill-detector configuration — loaded from environment variables.
 * Controls where skills are stored, when to fire notifications, and
 * the minimum thresholds used in Stage B clustering.
 */

import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillDetectorConfig {
  /** Directory where promoted skill YAML files live. */
  skillsDir: string;
  /** Shell command to run after a skill is promoted, or null to skip. */
  notifyCommand: string | null;
  /** Minimum tool operations per session episode to be considered (Stage B). */
  minToolOps: number;
  /** Minimum number of sessions a cluster must span to promote a skill. */
  minSessions: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");
const DEFAULT_NOTIFY_COMMAND = null;
const DEFAULT_MIN_TOOL_OPS = 5;
const DEFAULT_MIN_SESSIONS = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand a leading ~ to the user's home directory. */
function expandTilde(value: string): string {
  if (!value.startsWith("~")) return value;
  return path.join(os.homedir(), value.slice(1));
}

/**
 * Parse a positive integer from a string env value.
 * Returns the parsed number if valid and > 0, otherwise emits a warning and
 * returns the provided default.
 */
function parsePositiveInt(
  raw: string,
  varName: string,
  defaultValue: number,
): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    process.stderr.write(
      `[litopys/skills] ${varName}=${JSON.stringify(raw)} is not a positive integer, using default ${defaultValue}\n`,
    );
    return defaultValue;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the skill-detector config from environment variables.
 * Pass a custom env object in tests instead of mutating process.env.
 */
export function loadSkillConfig(
  env: NodeJS.ProcessEnv = process.env,
): SkillDetectorConfig {
  // --- skillsDir ---
  let skillsDir = DEFAULT_SKILLS_DIR;
  const rawSkillsDir = env.LITOPYS_SKILLS_DIR;
  if (rawSkillsDir !== undefined && rawSkillsDir !== "") {
    skillsDir = expandTilde(rawSkillsDir);
  }

  // --- notifyCommand ---
  let notifyCommand: string | null = DEFAULT_NOTIFY_COMMAND;
  const rawNotify = env.LITOPYS_SKILLS_NOTIFY_CMD;
  if (rawNotify !== undefined) {
    notifyCommand = rawNotify === "" ? null : rawNotify;
  }

  // --- minToolOps ---
  let minToolOps = DEFAULT_MIN_TOOL_OPS;
  const rawMinToolOps = env.LITOPYS_SKILLS_MIN_TOOL_OPS;
  if (rawMinToolOps !== undefined && rawMinToolOps !== "") {
    minToolOps = parsePositiveInt(rawMinToolOps, "LITOPYS_SKILLS_MIN_TOOL_OPS", DEFAULT_MIN_TOOL_OPS);
  }

  // --- minSessions ---
  let minSessions = DEFAULT_MIN_SESSIONS;
  const rawMinSessions = env.LITOPYS_SKILLS_MIN_SESSIONS;
  if (rawMinSessions !== undefined && rawMinSessions !== "") {
    minSessions = parsePositiveInt(rawMinSessions, "LITOPYS_SKILLS_MIN_SESSIONS", DEFAULT_MIN_SESSIONS);
  }

  return { skillsDir, notifyCommand, minToolOps, minSessions };
}
