import { promises as fs } from "node:fs";
import * as path from "node:path";
import { type AnyNode, AnyNodeSchema, loadGraph, withGraphLock, writeNode } from "@litopys/core";

interface ImportOptions {
  force: boolean;
  dryRun: boolean;
}

function parseArgs(args: string[]): { file: string; opts: ImportOptions } {
  let file: string | undefined;
  const opts: ImportOptions = { force: false, dryRun: false };

  for (const arg of args) {
    if (arg === "--force") {
      opts.force = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg.startsWith("--")) {
      process.stderr.write(`Unknown import flag: ${arg}\n`);
      process.exit(1);
    } else if (file === undefined) {
      file = arg;
    } else {
      process.stderr.write(`Unexpected positional argument: ${arg}\n`);
      process.exit(1);
    }
  }

  if (!file) {
    process.stderr.write("Usage: litopys import <file.json> [--force] [--dry-run]\n");
    process.exit(1);
  }

  return { file, opts };
}

interface ImportPayload {
  meta?: { schemaVersion?: number };
  nodes?: unknown[];
}

export async function cmdImport(args: string[], graphPath: string): Promise<void> {
  const { file, opts } = parseArgs(args);

  const raw = await fs.readFile(path.resolve(file), "utf-8");
  let payload: ImportPayload;
  try {
    payload = JSON.parse(raw) as ImportPayload;
  } catch (err) {
    process.stderr.write(`Failed to parse JSON: ${String(err)}\n`);
    process.exit(1);
  }

  const schemaVersion = payload.meta?.schemaVersion;
  if (schemaVersion !== 1) {
    process.stderr.write(
      `Unsupported schemaVersion: ${schemaVersion ?? "(missing)"} (expected 1)\n`,
    );
    process.exit(1);
  }

  const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  if (rawNodes.length === 0) {
    process.stderr.write("Nothing to import: payload contains no nodes.\n");
    process.exit(1);
  }

  // Validate every node up-front — fail-fast before touching disk.
  const validated: AnyNode[] = [];
  const validationErrors: string[] = [];
  for (const [i, n] of rawNodes.entries()) {
    const result = AnyNodeSchema.safeParse(n);
    if (!result.success) {
      const id =
        (n && typeof n === "object" && "id" in n ? String((n as { id: unknown }).id) : null) ??
        `#${i}`;
      validationErrors.push(`  ${id}: ${result.error.issues.map((x) => x.message).join("; ")}`);
    } else {
      validated.push(result.data);
    }
  }

  if (validationErrors.length > 0) {
    process.stderr.write(
      `Refusing to import: ${validationErrors.length}/${rawNodes.length} nodes failed validation.\n`,
    );
    for (const msg of validationErrors) process.stderr.write(`${msg}\n`);
    process.exit(1);
  }

  const existing = await loadGraph(graphPath);
  const plan = {
    create: [] as AnyNode[],
    overwrite: [] as AnyNode[],
    skip: [] as AnyNode[],
  };

  for (const node of validated) {
    if (existing.nodes.has(node.id)) {
      if (opts.force) plan.overwrite.push(node);
      else plan.skip.push(node);
    } else {
      plan.create.push(node);
    }
  }

  const summary =
    `Plan: create ${plan.create.length}, ` +
    `overwrite ${plan.overwrite.length}, skip ${plan.skip.length}\n`;

  if (opts.dryRun) {
    process.stdout.write(`[dry-run] ${summary}`);
    for (const n of plan.create) process.stdout.write(`  + ${n.type}/${n.id}\n`);
    for (const n of plan.overwrite) process.stdout.write(`  ~ ${n.type}/${n.id}\n`);
    for (const n of plan.skip)
      process.stdout.write(`  - ${n.type}/${n.id} (exists, use --force)\n`);
    return;
  }

  process.stdout.write(summary);

  if (plan.create.length === 0 && plan.overwrite.length === 0) {
    if (plan.skip.length > 0) {
      process.stdout.write(
        "Nothing written. All nodes already exist; pass --force to overwrite.\n",
      );
    }
    return;
  }

  await withGraphLock(graphPath, async () => {
    for (const node of plan.create) {
      await writeNode(graphPath, node);
      process.stdout.write(`  + ${node.type}/${node.id}\n`);
    }
    for (const node of plan.overwrite) {
      await writeNode(graphPath, node);
      process.stdout.write(`  ~ ${node.type}/${node.id}\n`);
    }
  });

  for (const n of plan.skip) {
    process.stdout.write(`  - ${n.type}/${n.id} (skipped, exists; use --force to overwrite)\n`);
  }
}
