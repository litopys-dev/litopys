/**
 * `litopys evolve` — graph-evolution maintenance commands.
 *
 *   --archive-tombstoned [--older-than N]   move long-dead nodes to archive/
 *   --dry-run                                preview without writing
 *
 * (Future flags such as --auto-merge attach here in follow-up commits.)
 */

import { archiveTombstoned } from "@litopys/core";

interface EvolveOptions {
  archiveTombstoned: boolean;
  olderThan: number;
  dryRun: boolean;
}

function parseArgs(args: string[]): EvolveOptions {
  const opts: EvolveOptions = {
    archiveTombstoned: false,
    olderThan: 365,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--archive-tombstoned") {
      opts.archiveTombstoned = true;
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
    } else {
      process.stderr.write(`Unknown evolve flag: ${arg}\n`);
      process.exit(1);
    }
  }
  return opts;
}

function usage(): void {
  process.stderr.write(`Usage: litopys evolve [flags]

Flags:
  --archive-tombstoned          move nodes whose 'until' is past the cutoff
                                into <graph>/archive/, preserving subdirs
  --older-than N                only archive tombstoned nodes whose until is
                                more than N days ago (default 365)
  --dry-run                     print the plan, write nothing
`);
}

export async function cmdEvolve(args: string[], graphPath: string): Promise<void> {
  const opts = parseArgs(args);

  if (!opts.archiveTombstoned) {
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
}
