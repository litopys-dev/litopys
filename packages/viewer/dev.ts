import { promises as fs } from "node:fs";
import * as path from "node:path";
import { build } from "./build.ts";
import { createServer } from "./src/server.ts";

const root = import.meta.dir;
const port = Number(process.env["VIEWER_PORT"] ?? 3999);

console.log("[viewer] initial build…");
const t0 = performance.now();
await build({ minify: false });
console.log(`[viewer] built in ${Math.round(performance.now() - t0)}ms`);

const server = createServer(port);
console.log(`[viewer] dev server: http://localhost:${server.port}/`);

// File watcher: rebuild on src/ changes.
const watcher = fs.watch(path.join(root, "src"), { recursive: true });
let pending = false;
let running = false;

async function rebuild(): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const s = performance.now();
  try {
    await build({ minify: false });
    console.log(`[viewer] rebuilt in ${Math.round(performance.now() - s)}ms`);
  } catch (err) {
    console.error("[viewer] rebuild failed:", err);
  } finally {
    running = false;
    if (pending) {
      pending = false;
      void rebuild();
    }
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null;
for await (const evt of watcher) {
  if (!evt.filename) continue;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    void rebuild();
  }, 80);
}
