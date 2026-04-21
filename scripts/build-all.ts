#!/usr/bin/env bun
/**
 * Cross-compile Litopys CLI binaries for the five platforms bun supports
 * via `--target=bun-<os>-<arch>`.
 *
 * Outputs: dist/litopys-<target>{,.exe}
 */

import { chmod, stat } from "node:fs/promises";
import { $ } from "bun";

const ENTRY = "packages/cli/src/index.ts";
const OUT_DIR = "dist";

interface Target {
  target: string;
  filename: string;
}

const TARGETS: Target[] = [
  { target: "bun-linux-x64", filename: "litopys-linux-x64" },
  { target: "bun-linux-arm64", filename: "litopys-linux-arm64" },
  { target: "bun-darwin-x64", filename: "litopys-darwin-x64" },
  { target: "bun-darwin-arm64", filename: "litopys-darwin-arm64" },
  { target: "bun-windows-x64", filename: "litopys-windows-x64.exe" },
];

const onlyTarget = process.argv[2];

for (const t of TARGETS) {
  if (onlyTarget && !t.target.includes(onlyTarget) && !t.filename.includes(onlyTarget)) continue;

  const outfile = `${OUT_DIR}/${t.filename}`;
  process.stdout.write(`[build] ${t.target} → ${outfile}\n`);

  const started = Date.now();
  await $`bun build --compile --minify --target=${t.target} --outfile=${outfile} ${ENTRY}`.quiet();
  await chmod(outfile, 0o755).catch(() => {});
  const info = await stat(outfile);
  const mb = (info.size / 1024 / 1024).toFixed(1);
  process.stdout.write(`[build] ${t.filename} — ${mb} MB (${Date.now() - started}ms)\n`);
}

process.stdout.write("[build] done\n");
