import { open, stat, unlink } from "node:fs/promises";
import * as path from "node:path";

export class GraphLockTimeoutError extends Error {
  constructor(graphPath: string, timeoutMs: number) {
    super(
      `Could not acquire graph lock for "${graphPath}" within ${timeoutMs}ms. ` +
        `Another process may be holding the lock. Check ${path.join(graphPath, ".lock")} for the holder's PID.`,
    );
    this.name = "GraphLockTimeoutError";
  }
}

export interface GraphLockOptions {
  /** Max time to wait for lock acquisition (default: 5000ms) */
  timeoutMs?: number;
  /** Treat a lockfile older than this as stale and override it (default: 60_000ms) */
  staleAgeMs?: number;
  /** Polling interval between acquisition attempts (default: 50ms) */
  retryIntervalMs?: number;
}

/**
 * Acquire an exclusive lock on <graphPath>/.lock, run fn, release lock.
 *
 * Uses O_EXCL (wx flag) — only one process can create the file.
 * Stale detection: if the existing lockfile's mtime is older than staleAgeMs,
 * it is removed and one immediate retry is performed.
 * On timeout throws GraphLockTimeoutError.
 * Lock is always released in the finally block, even if fn throws.
 */
export async function withGraphLock<T>(
  graphPath: string,
  fn: () => Promise<T>,
  options?: GraphLockOptions,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const staleAgeMs = options?.staleAgeMs ?? 60_000;
  const retryIntervalMs = options?.retryIntervalMs ?? 50;

  const lockPath = path.join(graphPath, ".lock");
  const deadline = Date.now() + timeoutMs;

  let acquired = false;

  while (true) {
    // Attempt exclusive create
    try {
      const fh = await open(lockPath, "wx");
      await fh.write(`${process.pid}@${Date.now()}\n`);
      await fh.close();
      acquired = true;
      break;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        // Unexpected error (e.g. ENOENT if graphPath doesn't exist) — re-throw
        throw err;
      }
      // Lock exists — check if stale
      try {
        const st = await stat(lockPath);
        const age = Date.now() - st.mtimeMs;
        if (age > staleAgeMs) {
          await unlink(lockPath);
          // Retry immediately (don't fall through to sleep)
          continue;
        }
      } catch {
        // lockfile disappeared between open and stat — retry immediately
        continue;
      }
    }

    // Check deadline before sleeping
    if (Date.now() >= deadline) {
      throw new GraphLockTimeoutError(graphPath, timeoutMs);
    }

    // Wait before next attempt
    await new Promise<void>((resolve) => setTimeout(resolve, retryIntervalMs));

    // Re-check deadline after sleep
    if (Date.now() >= deadline) {
      throw new GraphLockTimeoutError(graphPath, timeoutMs);
    }
  }

  // We hold the lock — run fn and always release
  try {
    return await fn();
  } finally {
    if (acquired) {
      await unlink(lockPath).catch(() => {
        // Ignore: another process may have cleaned up a stale lock
      });
    }
  }
}
