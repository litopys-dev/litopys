import { promises as fs } from "node:fs";
import * as path from "node:path";

export async function cmdViewer(args: string[]): Promise<void> {
  let port = 3999;
  let openBrowser = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) {
      port = Number(args[i + 1]);
      i++;
    } else if (arg === "--no-open") {
      openBrowser = false;
    } else {
      process.stderr.write(`Unknown viewer flag: ${arg}\n`);
      process.exit(1);
    }
  }

  const pkgDir = resolveViewerPackage();
  const distDir = path.join(pkgDir, "dist");

  try {
    await fs.access(path.join(distDir, "index.html"));
  } catch {
    process.stderr.write(`Viewer is not built. Run: bun --cwd ${pkgDir} run build\n`);
    process.exit(1);
  }

  const { createServer } = (await import(
    /* @vite-ignore */ path.join(pkgDir, "src/server.ts")
  )) as { createServer: (port: number) => { port: number; stop: () => void } };

  const server = createServer(port);
  const url = `http://localhost:${server.port}/`;
  process.stdout.write(`Viewer running at ${url}\n`);

  if (openBrowser) {
    tryOpenBrowser(url);
  }

  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function resolveViewerPackage(): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..", "..", "viewer");
}

function tryOpenBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    proc.unref();
  } catch {
    // no-op — headless environment is fine, URL is already printed
  }
}
