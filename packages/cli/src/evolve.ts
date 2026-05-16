/**
 * `litopys evolve` — graph-evolution maintenance commands.
 *
 *   --archive-tombstoned [--older-than N]    move long-dead nodes to archive/
 *   --auto-merge        [--min-similarity F] accept high-confidence merge proposals
 *   --dry-run                                 preview without writing
 *
 * Both flags may be combined: archive first, then auto-merge.
 */

import * as path from "node:path";
import { archiveTombstoned } from "@litopys/core";
import { autoMergeProposals } from "@litopys/extractor";

interface EvolveOptions {
  archiveTombstoned: boolean;
  autoMerge: boolean;
  olderThan: number;
  minSimilarity: number;
  dryRun: boolean;
}

function parseArgs(args: string[]): EvolveOptions {
  const opts: EvolveOptions = {
    archiveTombstoned: false,
    autoMerge: false,
    olderThan: 365,
    minSimilarity: 0.95,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--archive-tombstoned") {
      opts.archiveTombstoned = true;
    } else if (arg === "--auto-merge") {
      opts.autoMerge = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--older-than") {
      const v = args[++i];
      if (v === undefined) {
        process.stderr.write("--older-than requires a number of days\n");
        process.exit(1);
      }
      const n = Number.parseInt(v, 10);
      if (!Number.isInteger(n) || n < 0) {
        process.stderr.write(`--older-than must be a non-negative integer, got "${v}"\n`);
        process.exit(1);
      }
      opts.olderThan = n;
    } else if (arg === "--min-similarity") {
      const v = args[++i];
      if (v === undefined) {
        process.stderr.write("--min-similarity requires a number 0..1\n");
        process.exit(1);
      }
      const f = Number.parseFloat(v);
      if (!Number.isFinite(f) || f < 0 || f > 1) {
        process.stderr.write(`--min-similarity must be 0..1, got "${v}"\n`);
        process.exit(1);
      }
      opts.minSimilarity = f;
    } else {
      process.stderr.write(`Unknown evolve flag: ${arg}\n`);
      process.exit(1);
    }
  }
  return opts;
}

function usage(): void {
  process.stderr.write(`Usage: litopys evolve [flags]

Flags (at least one required):
  --archive-tombstoned          move nodes whose 'until' is past the cutoff
                                into <graph>/archive/, preserving subdirs
  --auto-merge                  accept queued merge proposals whose detected
                                similarity is >= --min-similarity

Modifiers:
  --older-than N                only archive tombstoned nodes whose until is
                                more than N days ago (default 365)
  --min-similarity F            only auto-accept merge proposals with similarity
                                score >= F (default 0.95)
  --dry-run                     print the plan, write nothing
`);
}

export async function cmdEvolve(args: string[], graphPath: string): Promise<void> {
  const opts = parseArgs(args);

  if (!opts.archiveTombstoned && !opts.autoMerge) {
    usage();
    process.exit(1);
  }

  if (opts.archiveTombstoned) {
    const result = await archiveTombstoned(graphPath, {
      olderThan: opts.olderThan,
      dryRun: opts.dryRun,
    });
    const verb = opts.dryRun ? "Would archive" : "Archived";
    process.stdout.write(
      `${verb} ${result.planned.length} tombstoned node(s) older than ${opts.olderThan} day(s) (scanned ${result.scanned})\n`,
    );
    for (const item of result.planned.slice(0, 50)) {
      process.stdout.write(
        `  ${item.id}: ${item.originalPath} -> ${item.archivePath} (until=${item.until})\n`,
      );
    }
    if (result.planned.length > 50) {
      process.stdout.write(`  ... and ${result.planned.length - 50} more\n`);
    }
  }

  if (opts.autoMerge) {
    const quarantineDir = path.join(graphPath, "..", "quarantine");
    const result = await autoMergeProposals({
      quarantineDir,
      graphPath,
      minSimilarity: opts.minSimilarity,
      dryRun: opts.dryRun,
    });
    const verb = opts.dryRun ? "Would auto-merge" : "Auto-merged";
    process.stdout.write(
      `${verb} ${result.merged.length} proposal(s) at similarity >= ${opts.minSimilarity} (scanned ${result.scanned}, skipped ${result.skipped.length})\n`,
    );
    for (const item of result.merged) {
      process.stdout.write(
        `  ${path.basename(item.proposalPath)}: ${item.loserId} -> ${item.winnerId} (similarity=${item.similarity.toFixed(3)})\n`,
      );
    }
    if (result.errors.length > 0) {
      process.stdout.write(`Errors (${result.errors.length}):\n`);
      for (const err of result.errors) {
        process.stdout.write(`  ${path.basename(err.proposalPath)}: ${err.message}\n`);
      }
    }
  }
}
