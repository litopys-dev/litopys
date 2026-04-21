import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SERVICE_NAME = "litopys-viewer.service";

export async function cmdViewer(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "install") return installService(args.slice(1));
  if (sub === "uninstall") return uninstallService();

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

// ---------------------------------------------------------------------------
// install / uninstall — user systemd unit for autostart
// ---------------------------------------------------------------------------

async function installService(args: string[]): Promise<void> {
  let port: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) {
      port = Number(args[i + 1]);
      i++;
    } else {
      process.stderr.write(`Unknown install flag: ${arg}\n`);
      process.exit(1);
    }
  }

  if (process.platform !== "linux") {
    process.stderr.write("litopys viewer install is only supported on Linux (systemd).\n");
    process.exit(1);
  }

  const unitDir = path.join(os.homedir(), ".config", "systemd", "user");
  await fs.mkdir(unitDir, { recursive: true });
  const unitPath = path.join(unitDir, SERVICE_NAME);

  const exec = buildExecStart();
  const envLines = port ? `Environment=VIEWER_PORT=${port}\n` : "";
  const wd = exec.workingDirectory ? `WorkingDirectory=${exec.workingDirectory}\n` : "";

  const unit = `[Unit]
Description=Litopys web dashboard (read-only graph viewer)
Documentation=https://github.com/litopys-dev/litopys
After=network.target

[Service]
Type=simple
${wd}ExecStart=${exec.execStart}
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=litopys-viewer
${envLines}
[Install]
WantedBy=default.target
`;

  await fs.writeFile(unitPath, unit, "utf8");
  process.stdout.write(`Wrote ${unitPath}\n`);

  await runSystemctl(["--user", "daemon-reload"]);
  await runSystemctl(["--user", "enable", "--now", SERVICE_NAME]);

  const p = port ?? 3999;
  process.stdout.write(`\nlitopys-viewer enabled. Dashboard: http://localhost:${p}/\n`);
  process.stdout.write("Status:   systemctl --user status litopys-viewer\n");
  process.stdout.write("Logs:     journalctl --user -u litopys-viewer -f\n");
}

async function uninstallService(): Promise<void> {
  if (process.platform !== "linux") {
    process.stderr.write("litopys viewer uninstall is only supported on Linux.\n");
    process.exit(1);
  }
  const unitPath = path.join(os.homedir(), ".config", "systemd", "user", SERVICE_NAME);

  await runSystemctl(["--user", "disable", "--now", SERVICE_NAME], { ignoreErr: true });
  try {
    await fs.unlink(unitPath);
    process.stdout.write(`Removed ${unitPath}\n`);
  } catch {
    process.stdout.write(`No unit at ${unitPath}\n`);
  }
  await runSystemctl(["--user", "daemon-reload"], { ignoreErr: true });
}

function buildExecStart(): { execStart: string; workingDirectory?: string } {
  // Detect whether we're running from a compiled single-file binary or a dev
  // invocation via `bun path/to/index.ts …`.
  const entry = process.argv[1] ?? "";
  const runningFromSource = entry.endsWith(".ts") || entry.endsWith(".js");

  if (!runningFromSource) {
    const bin = process.execPath;
    return { execStart: `${bin} viewer --no-open` };
  }

  const bun = process.execPath;
  const monorepoRoot = path.resolve(entry, "..", "..", "..", "..");
  return {
    execStart: `${bun} ${entry} viewer --no-open`,
    workingDirectory: monorepoRoot,
  };
}

async function runSystemctl(args: string[], opts: { ignoreErr?: boolean } = {}): Promise<void> {
  // systemctl --user needs XDG_RUNTIME_DIR and a DBus socket — missing when
  // invoked from a context without an interactive login session (e.g. inside
  // another agent's subprocess). Fill them in from /run/user/<uid> if linger
  // is active so the common case still works.
  const uid = process.getuid?.() ?? 0;
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  const dbusAddr = process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtimeDir}/bus`;

  const proc = Bun.spawn(["systemctl", ...args], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
    env: {
      ...process.env,
      XDG_RUNTIME_DIR: runtimeDir,
      DBUS_SESSION_BUS_ADDRESS: dbusAddr,
    },
  });
  const code = await proc.exited;
  if (code !== 0 && !opts.ignoreErr) {
    process.stderr.write(`systemctl ${args.join(" ")} exited with ${code}\n`);
    process.exit(code);
  }
}
