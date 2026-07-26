/**
 * `litopys daemon` CLI — subcommands for the periodic incremental extractor daemon.
 *
 * Subcommands:
 *   tick           One-shot tick (designed for systemd oneshot + timer)
 *   status         Show daemon state in human-readable form
 *   reset [path]   Reset byte offset for one path, or all paths
 *   baseline       Set byte offsets to current file sizes (skip history)
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  defaultStatePath,
  expandTilde,
  loadSourceConfigs,
  loadState,
  runEpisodesCatchup,
  runTick,
  saveState,
} from "@litopys/daemon";
import {
  autoAcceptCandidates,
  createAdapter,
  defaultEpisodesDir,
  loadSkillConfig,
} from "@litopys/extractor";

/**
 * Auto-accept threshold for the hourly tick.
 *
 * Set LITOPYS_AUTO_ACCEPT to a confidence in 0..1, or to "off" to disable.
 * Default 0.9: an extraction pipeline whose only exit is manual review silts up,
 * so the loop closes itself unless an operator opts out.
 */
function autoAcceptThreshold(): number | undefined {
  const raw = (process.env.LITOPYS_AUTO_ACCEPT ?? "0.9").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0") return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    process.stderr.write(
      `[litopys/daemon] Ignoring invalid LITOPYS_AUTO_ACCEPT="${raw}" — using 0.9\n`,
    );
    return 0.9;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// tick
// ---------------------------------------------------------------------------

export async function cmdDaemonTick(args: string[], graphPath: string): Promise<void> {
  let dryRun = false;
  let provider: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--provider" && args[i + 1]) {
      provider = args[++i];
    }
  }

  const statePath = defaultStatePath();
  const sources = loadSourceConfigs();

  if (dryRun) {
    process.stdout.write("[dry-run] daemon tick — no quarantine files will be written\n");
  }

  const state = await loadState(statePath);
  let result: Awaited<ReturnType<typeof runTick>>;

  try {
    result = await runTick({ sources, graphPath, provider, dryRun }, state);
  } catch (err) {
    process.stderr.write(`[litopys/daemon] Tick failed: ${String(err)}\n`);
    process.exit(1);
  }

  // Episodes catch-up pass — runs AFTER runTick, sequentially (single-writer
  // contract: appendEpisodes and markClustered must never run concurrently
  // against the same episodesDir — see JSDoc on markClustered in episode-store.ts).
  // In dry-run the pass is a no-op (no LLM calls, no writes, no episodesState
  // mutation) — runEpisodesCatchup owns that contract.
  let catchupResult: { filesProcessed: number; episodesFound: number } = {
    filesProcessed: 0,
    episodesFound: 0,
  };
  try {
    // createAdapter owns the provider fallback (env var → "anthropic" default)
    const episodesAdapter = createAdapter(provider);
    const maxLlmFilesPerTick = process.env.LITOPYS_EPISODES_MAX_LLM_FILES
      ? Number(process.env.LITOPYS_EPISODES_MAX_LLM_FILES)
      : undefined; // falls back to default (10) in runEpisodesCatchup
    const skillCfg = loadSkillConfig();
    catchupResult = await runEpisodesCatchup(
      {
        sources,
        adapter: episodesAdapter,
        episodesDir: defaultEpisodesDir(),
        dryRun,
        maxLlmFilesPerTick,
        minToolOps: skillCfg.minToolOps,
        lang: skillCfg.lang,
      },
      state,
    );
  } catch (err) {
    process.stderr.write(`[litopys/episodes] Catch-up pass failed: ${String(err)}\n`);
    // Catch-up errors do not abort the tick
  }

  // Persist state (even in dry-run — offsets are still advanced so we don't re-process)
  // episodesState is part of state and is persisted by the same mechanism.
  await saveState(statePath, state);

  // Auto-accept pass — lands high-confidence candidates so the review queue
  // does not grow unbounded. Runs after extraction so candidates written by
  // this very tick are considered. Never aborts the tick.
  const threshold = autoAcceptThreshold();
  if (threshold === undefined) {
    process.stdout.write("Auto-accept: disabled (LITOPYS_AUTO_ACCEPT=off)\n");
  } else {
    try {
      const accept = await autoAcceptCandidates({
        quarantineDir: path.join(graphPath, "..", "quarantine"),
        graphPath,
        minConfidence: threshold,
        dryRun,
      });
      process.stdout.write(
        `Auto-accept (>=${threshold}): ${accept.accepted.length} node(s), ` +
          `${accept.relationsApplied} relation(s), ${accept.pruned} pruned, ` +
          `${accept.skipped.length} left for review, ${accept.filesRemoved} file(s) cleared\n`,
      );
      for (const e of accept.errors) {
        process.stderr.write(`  [auto-accept error] ${e.candidateId}: ${e.message}\n`);
      }
    } catch (err) {
      process.stderr.write(`[litopys/auto-accept] pass failed: ${String(err)}\n`);
    }
  }

  process.stdout.write(
    `Tick at ${result.tickedAt}: scanned ${result.filesScanned} file(s), updated ${result.filesUpdated}\n`,
  );

  if (result.candidatesTotal > 0 || result.relationsTotal > 0) {
    process.stdout.write(
      `Found ${result.candidatesTotal} candidate(s), ${result.relationsTotal} relation(s)\n`,
    );
  }

  if (dryRun) {
    process.stdout.write("[dry-run] episodes catch-up skipped\n");
  } else if (catchupResult.filesProcessed > 0 || catchupResult.episodesFound > 0) {
    process.stdout.write(
      `Episodes catch-up: processed ${catchupResult.filesProcessed} file(s), found ${catchupResult.episodesFound} episode(s)\n`,
    );
  }

  if (!dryRun) {
    for (const qf of result.quarantineFiles) {
      process.stdout.write(`  → ${qf}\n`);
    }
  }

  for (const { filePath, error } of result.errors) {
    process.stderr.write(`  [error] ${filePath}: ${error}\n`);
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function cmdDaemonStatus(): Promise<void> {
  const statePath = defaultStatePath();
  const state = await loadState(statePath);

  process.stdout.write(`State file: ${statePath}\n`);

  if (state.lastTick) {
    process.stdout.write(`Last tick:  ${state.lastTick}\n`);
  } else {
    process.stdout.write("Last tick:  (never run)\n");
  }

  const entries = Object.entries(state.sources);
  if (entries.length === 0) {
    process.stdout.write("No files tracked yet.\n");
    return;
  }

  process.stdout.write(`\nTracked files (${entries.length}):\n`);
  for (const [filePath, fileState] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const short = path.basename(filePath);
    const dir = path.dirname(filePath);
    process.stdout.write(
      `  ${short}\n` +
        `    path:    ${dir}/${short}\n` +
        `    adapter: ${fileState.adapter}\n` +
        `    offset:  ${fileState.byteOffset} bytes\n` +
        `    mtime:   ${fileState.mtime}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

export async function cmdDaemonReset(args: string[]): Promise<void> {
  const statePath = defaultStatePath();
  const state = await loadState(statePath);

  const targetPath = args[0];

  if (targetPath) {
    const absPath = path.resolve(targetPath);
    if (!(absPath in state.sources)) {
      process.stderr.write(`Path not tracked: ${absPath}\n`);
      process.exit(1);
    }
    delete state.sources[absPath];
    await saveState(statePath, state);
    process.stdout.write(`Reset offset for: ${absPath}\n`);
  } else {
    // Reset all
    const count = Object.keys(state.sources).length;
    state.sources = {};
    state.lastTick = undefined;
    await saveState(statePath, state);
    process.stdout.write(`Reset ${count} tracked file(s).\n`);
  }
}

// ---------------------------------------------------------------------------
// baseline
// ---------------------------------------------------------------------------

export async function cmdDaemonBaseline(args: string[]): Promise<void> {
  let dryRun = false;
  let force = false;

  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
  }

  const statePath = defaultStatePath();
  const sources = loadSourceConfigs();

  // Expand all globs into (filePath, adapterName) pairs
  const filePairs: Array<[string, string]> = [];
  for (const src of sources) {
    const pattern = expandTilde(src.glob);
    const paths = await expandGlobPattern(pattern);
    for (const p of paths) {
      filePairs.push([p, src.adapter]);
    }
  }

  const state = await loadState(statePath);

  let baselined = 0;
  let skipped = 0;
  let totalBytes = 0;

  for (const [filePath, adapterName] of filePairs) {
    const alreadyTracked = filePath in state.sources;

    if (alreadyTracked && !force) {
      skipped++;
      continue;
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(filePath);
    } catch {
      // File disappeared — skip
      continue;
    }

    const size = stat.size;
    const mtime = stat.mtime.toISOString();

    if (dryRun) {
      process.stdout.write(`[dry-run] would baseline: ${filePath} (${size} bytes)\n`);
    } else {
      state.sources[filePath] = { byteOffset: size, mtime, adapter: adapterName };
    }

    baselined++;
    totalBytes += size;
  }

  if (!dryRun) {
    await saveState(statePath, state);
  }

  const dryTag = dryRun ? "[dry-run] " : "";
  process.stdout.write(
    `${dryTag}baselined ${baselined} files (skipped ${skipped} already tracked), total bytes: ${totalBytes}\n`,
  );
}

/** Expand a glob pattern into absolute file paths (same logic as tick.ts). */
async function expandGlobPattern(pattern: string): Promise<string[]> {
  const { glob } = await import("node:fs/promises");

  if (/[*?{}\[\]]/.test(pattern)) {
    try {
      const matches: string[] = [];
      const parts = pattern.split("/");
      let baseDir = "/";
      let relPattern = pattern;

      const firstGlobIdx = parts.findIndex((p) => /[*?{}\[\]]/.test(p));
      if (firstGlobIdx > 0) {
        baseDir = parts.slice(0, firstGlobIdx).join("/") || "/";
        relPattern = parts.slice(firstGlobIdx).join("/");
      }

      for await (const match of glob(relPattern, { cwd: baseDir })) {
        matches.push(path.join(baseDir, match));
      }
      return matches.sort();
    } catch {
      return [];
    }
  }

  try {
    await fs.access(pattern);
    return [pattern];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/** Full CLI handler for `litopys daemon`. */
export async function cmdDaemon(args: string[], graphPath: string): Promise<void> {
  const sub = args[0];

  if (sub === "tick") {
    await cmdDaemonTick(args.slice(1), graphPath);
  } else if (sub === "status") {
    await cmdDaemonStatus();
  } else if (sub === "reset") {
    await cmdDaemonReset(args.slice(1));
  } else if (sub === "baseline") {
    await cmdDaemonBaseline(args.slice(1));
  } else {
    process.stderr.write("Usage: litopys daemon <tick|status|reset|baseline>\n");
    process.stderr.write("  tick [--dry-run] [--provider <name>]  Run one incremental tick\n");
    process.stderr.write("  status                                 Show state file\n");
    process.stderr.write("  reset [path]                           Reset offset(s)\n");
    process.stderr.write(
      "  baseline [--force] [--dry-run]         Set offsets to current file sizes\n",
    );
    process.exit(sub ? 1 : 0);
  }
}
