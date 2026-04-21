import { promises as fs } from "node:fs";
import * as path from "node:path";
import { SolidPlugin } from "bun-plugin-solid";

const root = import.meta.dir;
const distDir = path.join(root, "dist");

export async function build(opts: { minify?: boolean } = {}): Promise<void> {
  const minify = opts.minify ?? true;

  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [path.join(root, "src/app/main.tsx")],
    outdir: distDir,
    target: "browser",
    format: "esm",
    minify,
    plugins: [SolidPlugin()],
    naming: { entry: "main.js" },
  });

  if (!result.success) {
    for (const msg of result.logs) console.error(msg);
    throw new Error("Bundle failed");
  }

  const cssArgs = [
    "bunx",
    "tailwindcss",
    "-i",
    path.join(root, "src/app/index.css"),
    "-o",
    path.join(distDir, "styles.css"),
  ];
  if (minify) cssArgs.push("--minify");
  const tw = Bun.spawnSync(cssArgs, { cwd: root, stderr: "inherit", stdout: "inherit" });
  if (tw.exitCode !== 0) throw new Error(`tailwindcss exited with code ${tw.exitCode}`);

  await fs.copyFile(path.join(root, "index.html"), path.join(distDir, "index.html"));
}

if (import.meta.main) {
  const t0 = performance.now();
  await build();
  console.log(`Built viewer in ${Math.round(performance.now() - t0)}ms → dist/`);
}
