/**
 * `litopys daemon` CLI — subcommands for the periodic incremental extractor daemon.
 *
 * Subcommands:
 *   tick           One-shot tick (designed for systemd oneshot + timer)
 *   status         Show daemon state in human-readable form
 *   reset [path]   Reset byte offset for one path, or all paths
 */

import * as path from "node:path";
import {
  defaultStatePath,
  loadSourceConfigs,
  loadState,
  runTick,
  saveState,
} from "@litopys/daemon";

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

  // Persist state (even in dry-run — offsets are still advanced so we don't re-process)
  await saveState(statePath, state);

  process.stdout.write(
    `Tick at ${result.tickedAt}: scanned ${result.filesScanned} file(s), updated ${result.filesUpdated}\n`,
  );

  if (result.candidatesTotal > 0 || result.relationsTotal > 0) {
    process.stdout.write(
      `Found ${result.candidatesTotal} candidate(s), ${result.relationsTotal} relation(s)\n`,
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
  } else {
    process.stderr.write("Usage: litopys daemon <tick|status|reset>\n");
    process.stderr.write("  tick [--dry-run] [--provider <name>]  Run one incremental tick\n");
    process.stderr.write("  status                                 Show state file\n");
    process.stderr.write("  reset [path]                           Reset offset(s)\n");
    process.exit(sub ? 1 : 0);
  }
}
