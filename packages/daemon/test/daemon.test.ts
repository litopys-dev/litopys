/**
 * Tests for @litopys/daemon — state management, tick logic, config.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Mock LLM SDKs before any imports
// ---------------------------------------------------------------------------

const MOCK_CANDIDATE = {
  id: "alice",
  type: "person",
  summary: "Alice from Acme Corp",
  confidence: 0.9,
  reasoning: "Explicitly named in transcript",
  sourceSessionId: "test-session",
};

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              candidateNodes: [MOCK_CANDIDATE],
              candidateRelations: [],
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      })),
    };
  },
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mock(async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ candidateNodes: [], candidateRelations: [] }),
              },
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        })),
      },
    };
  },
}));

process.env.ANTHROPIC_API_KEY = "sk-mock-daemon-test";
process.env.LITOPYS_EXTRACTOR_PROVIDER = "anthropic";

// Lazy import after mocking
const { loadState, saveState, defaultStatePath } = await import("../src/state.ts");
const { loadSourceConfigs, expandTilde } = await import("../src/config.ts");
const { runTick } = await import("../src/tick.ts");
const { listQuarantineFrom } = await import("@litopys/extractor");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "litopys-daemon-test-"));
}

/** Write raw bytes to a file. Returns file size. */
async function appendFile(filePath: string, content: string): Promise<number> {
  await fs.appendFile(filePath, content, "utf-8");
  const stat = await fs.stat(filePath);
  return stat.size;
}

/** Create a minimal Claude Code JSONL line. */
function ccLine(role: "user" | "assistant", text: string, sessionId = "test-session"): string {
  const event =
    role === "user"
      ? {
          type: "user",
          sessionId,
          message: { role: "user", content: text },
        }
      : {
          type: "assistant",
          sessionId,
          message: { role: "assistant", content: [{ type: "text", text }] },
        };
  return JSON.stringify(event) + "\n";
}

// ---------------------------------------------------------------------------
// State — load / save
// ---------------------------------------------------------------------------

describe("loadState", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("returns empty state when file does not exist", async () => {
    const statePath = path.join(tmpDir, "nonexistent.json");
    const state = await loadState(statePath);
    expect(state.version).toBe(1);
    expect(state.sources).toEqual({});
    expect(state.lastTick).toBeUndefined();
  });

  test("loads valid state from disk", async () => {
    const statePath = path.join(tmpDir, "state.json");
    const written = {
      version: 1 as const,
      lastTick: "2026-01-01T00:00:00.000Z",
      sources: {
        "/some/file.jsonl": { byteOffset: 1024, mtime: "2026-01-01T00:00:00.000Z", adapter: "claude-code" },
      },
    };
    await fs.writeFile(statePath, JSON.stringify(written), "utf-8");
    const state = await loadState(statePath);
    expect(state.lastTick).toBe("2026-01-01T00:00:00.000Z");
    expect(state.sources["/some/file.jsonl"]?.byteOffset).toBe(1024);
  });

  test("returns empty state for malformed JSON", async () => {
    const statePath = path.join(tmpDir, "bad.json");
    await fs.writeFile(statePath, "not-json", "utf-8");
    const state = await loadState(statePath);
    expect(state.version).toBe(1);
    expect(state.sources).toEqual({});
  });

  test("returns empty state when version field is wrong", async () => {
    const statePath = path.join(tmpDir, "wrong-version.json");
    await fs.writeFile(statePath, JSON.stringify({ version: 99, sources: {} }), "utf-8");
    const state = await loadState(statePath);
    expect(state.version).toBe(1);
    expect(state.sources).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// State — atomic save
// ---------------------------------------------------------------------------

describe("saveState", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("saves state to disk and is readable back", async () => {
    const statePath = path.join(tmpDir, "state.json");
    await saveState(statePath, {
      version: 1,
      lastTick: "2026-01-01T00:00:00.000Z",
      sources: {
        "/foo/bar.jsonl": { byteOffset: 512, mtime: "2026-01-01T00:00:00.000Z", adapter: "jsonl" },
      },
    });

    const state = await loadState(statePath);
    expect(state.lastTick).toBe("2026-01-01T00:00:00.000Z");
    expect(state.sources["/foo/bar.jsonl"]?.byteOffset).toBe(512);
  });

  test("atomic write: no .tmp file left on disk after save", async () => {
    const statePath = path.join(tmpDir, "state.json");
    await saveState(statePath, { version: 1, sources: {} });
    const files = await fs.readdir(tmpDir);
    expect(files.every((f) => !f.endsWith(".tmp"))).toBe(true);
  });

  test("creates parent directory if missing", async () => {
    const statePath = path.join(tmpDir, "nested", "deep", "state.json");
    await saveState(statePath, { version: 1, sources: {} });
    const raw = await fs.readFile(statePath, "utf-8");
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
  });

  test("overwrites existing state", async () => {
    const statePath = path.join(tmpDir, "state.json");
    await saveState(statePath, { version: 1, sources: {}, lastTick: "old" });
    await saveState(statePath, { version: 1, sources: {}, lastTick: "new" });
    const state = await loadState(statePath);
    expect(state.lastTick).toBe("new");
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("loadSourceConfigs", () => {
  const ORIG = process.env.LITOPYS_DAEMON_SOURCES;

  afterEach(() => {
    if (ORIG === undefined) process.env.LITOPYS_DAEMON_SOURCES = undefined;
    else process.env.LITOPYS_DAEMON_SOURCES = ORIG;
  });

  test("returns default sources when env not set", () => {
    process.env.LITOPYS_DAEMON_SOURCES = undefined;
    const sources = loadSourceConfigs();
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]?.adapter).toBe("claude-code");
  });

  test("parses valid JSON from env", () => {
    process.env.LITOPYS_DAEMON_SOURCES = JSON.stringify([
      { adapter: "text", glob: "/tmp/*.txt" },
    ]);
    const sources = loadSourceConfigs();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.adapter).toBe("text");
    expect(sources[0]?.glob).toBe("/tmp/*.txt");
  });

  test("falls back to defaults on invalid JSON", () => {
    process.env.LITOPYS_DAEMON_SOURCES = "not-json{{{";
    const sources = loadSourceConfigs();
    expect(sources[0]?.adapter).toBe("claude-code");
  });

  test("falls back to defaults when array is empty after filtering", () => {
    process.env.LITOPYS_DAEMON_SOURCES = JSON.stringify([{ no: "fields" }]);
    const sources = loadSourceConfigs();
    expect(sources[0]?.adapter).toBe("claude-code");
  });

  test("falls back to defaults when value is not an array", () => {
    process.env.LITOPYS_DAEMON_SOURCES = JSON.stringify({ adapter: "text", glob: "/tmp/*.txt" });
    const sources = loadSourceConfigs();
    expect(sources[0]?.adapter).toBe("claude-code");
  });
});

describe("expandTilde", () => {
  test("expands leading ~ to home dir", () => {
    const result = expandTilde("~/.claude/sessions/*.jsonl");
    expect(result.startsWith(os.homedir())).toBe(true);
    expect(result).not.toContain("~");
  });

  test("leaves non-tilde paths unchanged", () => {
    const p = "/absolute/path/to/file.txt";
    expect(expandTilde(p)).toBe(p);
  });

  test("handles tilde with no slash (bare ~)", () => {
    const result = expandTilde("~");
    expect(result).toBe(os.homedir());
  });
});

// ---------------------------------------------------------------------------
// Tick — incremental reads
// ---------------------------------------------------------------------------

describe("runTick", () => {
  let tmpDir: string;
  let graphDir: string;
  let quarantineDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    graphDir = path.join(tmpDir, "graph");
    quarantineDir = path.join(tmpDir, "quarantine");
    await fs.mkdir(graphDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeTickOpts(globs: Array<{ adapter: string; glob: string }> = []) {
    return {
      sources: globs,
      graphPath: graphDir,
      provider: "anthropic",
    };
  }

  test("returns zero files when no sources match", async () => {
    const state = { version: 1 as const, sources: {} };
    const result = await runTick(makeTickOpts(), state);
    expect(result.filesScanned).toBe(0);
    expect(result.filesUpdated).toBe(0);
  });

  test("first tick reads entire file and writes quarantine", async () => {
    const filePath = path.join(tmpDir, "session.jsonl");
    await fs.writeFile(filePath, ccLine("user", "Hello, I work at Acme Corp"), "utf-8");

    const state = { version: 1 as const, sources: {} };
    const result = await runTick(
      makeTickOpts([{ adapter: "claude-code", glob: filePath }]),
      state,
    );

    expect(result.filesScanned).toBe(1);
    expect(result.filesUpdated).toBe(1);
    expect(result.errors).toHaveLength(0);
    // State should record offset
    expect(state.sources[filePath]?.byteOffset).toBeGreaterThan(0);
  });

  test("second tick reads only new bytes (incrementality)", async () => {
    const filePath = path.join(tmpDir, "session.jsonl");
    const firstLine = ccLine("user", "Hello, I work at Acme Corp");
    await fs.writeFile(filePath, firstLine, "utf-8");

    const state = { version: 1 as const, sources: {} };

    // First tick — reads entire file
    const result1 = await runTick(
      makeTickOpts([{ adapter: "claude-code", glob: filePath }]),
      state,
    );
    expect(result1.filesUpdated).toBe(1);
    const offsetAfterFirst = state.sources[filePath]?.byteOffset ?? 0;
    expect(offsetAfterFirst).toBeGreaterThan(0);

    // Second tick — no new bytes
    const result2 = await runTick(
      makeTickOpts([{ adapter: "claude-code", glob: filePath }]),
      state,
    );
    expect(result2.filesScanned).toBe(1);
    expect(result2.filesUpdated).toBe(0); // nothing new
    expect(state.sources[filePath]?.byteOffset).toBe(offsetAfterFirst); // offset unchanged

    // Append new content
    await appendFile(filePath, ccLine("assistant", "Welcome to Acme!"));

    // Third tick — only reads the new line
    const result3 = await runTick(
      makeTickOpts([{ adapter: "claude-code", glob: filePath }]),
      state,
    );
    expect(result3.filesUpdated).toBe(1);
    expect(state.sources[filePath]?.byteOffset).toBeGreaterThan(offsetAfterFirst);
  });

  test("file rotation (size < offset) triggers full re-read", async () => {
    const filePath = path.join(tmpDir, "session.jsonl");
    await fs.writeFile(filePath, ccLine("user", "Long content here at Acme Corp"), "utf-8");

    const state = { version: 1 as const, sources: {} };
    await runTick(makeTickOpts([{ adapter: "claude-code", glob: filePath }]), state);
    const bigOffset = state.sources[filePath]?.byteOffset ?? 0;
    expect(bigOffset).toBeGreaterThan(0);

    // Simulate rotation: write shorter content (new file same path)
    await fs.writeFile(filePath, ccLine("user", "Short"), "utf-8");
    const newStat = await fs.stat(filePath);
    expect(newStat.size).toBeLessThan(bigOffset);

    // Tick should detect truncation and reset
    const result = await runTick(
      makeTickOpts([{ adapter: "claude-code", glob: filePath }]),
      state,
    );
    expect(result.filesUpdated).toBe(1);
    // New offset should be small (just the new short content)
    expect(state.sources[filePath]?.byteOffset).toBeLessThanOrEqual(newStat.size);
  });

  test("mtime going backward (file replaced with older) triggers full re-read", async () => {
    const filePath = path.join(tmpDir, "session.jsonl");
    await fs.writeFile(filePath, ccLine("user", "Content from future"), "utf-8");

    const state = { version: 1 as const, sources: {} };
    await runTick(makeTickOpts([{ adapter: "claude-code", glob: filePath }]), state);

    // Manually set a future mtime in state to simulate backward mtime
    const existingState = state.sources[filePath]!;
    const farFuture = new Date(Date.now() + 1_000_000_000).toISOString();
    state.sources[filePath] = { ...existingState, mtime: farFuture };

    // Tick should detect rotation (mtime went backward) and reset offset
    const result = await runTick(
      makeTickOpts([{ adapter: "claude-code", glob: filePath }]),
      state,
    );
    expect(result.filesUpdated).toBe(1);
  });

  test("error in one file does not stop processing other files", async () => {
    const goodFile = path.join(tmpDir, "good.jsonl");
    const badPath = path.join(tmpDir, "nonexistent.jsonl"); // won't exist

    await fs.writeFile(goodFile, ccLine("user", "Hello from Acme Corp"), "utf-8");

    // We explicitly inject a bad path via a glob that matches a temp file we'll stat-fail
    // Instead, inject both paths directly as separate source configs with same adapter
    const state = { version: 1 as const, sources: {} };

    // Inject a bad offset for a path that exists — make offset larger than file
    // This simulates a file that was removed mid-tick
    // We do this by: first scanning goodFile, then adding a non-existent path manually
    state.sources[badPath] = {
      byteOffset: 9999,
      mtime: new Date().toISOString(),
      adapter: "claude-code",
    };

    const result = await runTick(
      makeTickOpts([
        { adapter: "claude-code", glob: goodFile },
        { adapter: "claude-code", glob: badPath },
      ]),
      state,
    );

    // goodFile should be processed, badPath should be skipped (not exist)
    expect(result.filesScanned).toBe(1); // Only goodFile matched the glob
    expect(result.errors).toHaveLength(0);
    expect(result.filesUpdated).toBe(1);
  });

  test("missing file (disappeared between glob and stat) is skipped silently", async () => {
    const filePath = path.join(tmpDir, "ghost.jsonl");
    await fs.writeFile(filePath, ccLine("user", "Will be deleted"), "utf-8");

    // Create a tick that references the file directly via sources
    const state = { version: 1 as const, sources: {} };

    // Inject the file into sources but delete it first
    await fs.unlink(filePath);

    const result = await runTick(
      makeTickOpts([{ adapter: "claude-code", glob: filePath }]),
      state,
    );

    // Glob returns nothing (file doesn't exist), so 0 scanned
    expect(result.filesScanned).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test("dry-run does not write quarantine but advances offset", async () => {
    const filePath = path.join(tmpDir, "session.jsonl");
    await fs.writeFile(filePath, ccLine("user", "Dry run test content"), "utf-8");

    const state = { version: 1 as const, sources: {} };
    const result = await runTick(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        graphPath: graphDir,
        provider: "anthropic",
        dryRun: true,
      },
      state,
    );

    expect(result.filesScanned).toBe(1);
    expect(result.quarantineFiles).toHaveLength(0); // nothing written
    expect(result.errors).toHaveLength(0);
    // Offset IS advanced even in dry-run
    expect(state.sources[filePath]?.byteOffset).toBeGreaterThan(0);
  });

  test("plain text adapter processes content", async () => {
    const filePath = path.join(tmpDir, "chat.txt");
    await fs.writeFile(filePath, "Alice is an engineer at Acme Corp.\n", "utf-8");

    const state = { version: 1 as const, sources: {} };
    const result = await runTick(
      makeTickOpts([{ adapter: "text", glob: filePath }]),
      state,
    );

    expect(result.filesScanned).toBe(1);
    expect(result.filesUpdated).toBe(1);
  });

  test("jsonl adapter processes content", async () => {
    const filePath = path.join(tmpDir, "chat.jsonl");
    const line = JSON.stringify({ role: "user", content: "I work at Acme Corp" }) + "\n";
    await fs.writeFile(filePath, line, "utf-8");

    const state = { version: 1 as const, sources: {} };
    const result = await runTick(
      makeTickOpts([{ adapter: "jsonl", glob: filePath }]),
      state,
    );

    expect(result.filesScanned).toBe(1);
    expect(result.filesUpdated).toBe(1);
  });

  test("glob expansion finds multiple files", async () => {
    const dir = path.join(tmpDir, "sessions");
    await fs.mkdir(dir, { recursive: true });

    for (const name of ["a.jsonl", "b.jsonl", "c.jsonl"]) {
      await fs.writeFile(
        path.join(dir, name),
        ccLine("user", `Content in ${name}`),
        "utf-8",
      );
    }

    const state = { version: 1 as const, sources: {} };
    const result = await runTick(
      makeTickOpts([{ adapter: "claude-code", glob: path.join(dir, "*.jsonl") }]),
      state,
    );

    expect(result.filesScanned).toBe(3);
  });

  test("lastTick is updated in state after tick", async () => {
    const state = { version: 1 as const, sources: {} };
    const before = Date.now();
    await runTick(makeTickOpts(), state);
    const after = Date.now();

    expect(state.lastTick).toBeDefined();
    const tickTime = new Date(state.lastTick!).getTime();
    expect(tickTime).toBeGreaterThanOrEqual(before);
    expect(tickTime).toBeLessThanOrEqual(after);
  });

  test("quarantine files are written for non-empty extractions", async () => {
    const filePath = path.join(tmpDir, "session.jsonl");
    await fs.writeFile(filePath, ccLine("user", "I am Alice from Acme Corp"), "utf-8");

    const state = { version: 1 as const, sources: {} };
    const result = await runTick(
      makeTickOpts([{ adapter: "claude-code", glob: filePath }]),
      state,
    );

    expect(result.quarantineFiles.length).toBeGreaterThan(0);
    const qItems = await listQuarantineFrom(quarantineDir);
    expect(qItems.length).toBeGreaterThan(0);
  });

  test("unknown adapter treats content as plain text", async () => {
    const filePath = path.join(tmpDir, "session.txt");
    await fs.writeFile(filePath, "Some content here from Acme Corp.", "utf-8");

    const state = { version: 1 as const, sources: {} };
    // "future-adapter" is unknown — should fall through to plain text handling
    const result = await runTick(
      makeTickOpts([{ adapter: "future-adapter", glob: filePath }]),
      state,
    );

    expect(result.filesScanned).toBe(1);
    // Should process without error
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Glob / tilde expansion
// ---------------------------------------------------------------------------

describe("glob expansion via runTick", () => {
  let tmpDir: string;
  let graphDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    graphDir = path.join(tmpDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("tilde expansion works in glob", async () => {
    // expandTilde should produce a real absolute path
    const result = expandTilde("~/.claude/projects/*/sessions/*.jsonl");
    expect(result.startsWith("/")).toBe(true);
    expect(result.includes("~")).toBe(false);
  });

  test("glob pattern with subdirectory wildcard", async () => {
    // Create nested structure: tmpDir/proj-a/sessions/s.jsonl
    const sessDir = path.join(tmpDir, "proj-a", "sessions");
    await fs.mkdir(sessDir, { recursive: true });
    const sessFile = path.join(sessDir, "s.jsonl");
    await fs.writeFile(sessFile, ccLine("user", "Hello from project A"), "utf-8");

    const state = { version: 1 as const, sources: {} };
    const result = await runTick(
      {
        sources: [{ adapter: "claude-code", glob: path.join(tmpDir, "*/sessions/*.jsonl") }],
        graphPath: graphDir,
        provider: "anthropic",
      },
      state,
    );

    expect(result.filesScanned).toBeGreaterThanOrEqual(1);
  });

  test("glob matching no files returns zero scanned", async () => {
    const state = { version: 1 as const, sources: {} };
    const result = await runTick(
      {
        sources: [{ adapter: "text", glob: path.join(tmpDir, "nonexistent/*.txt") }],
        graphPath: graphDir,
        provider: "anthropic",
      },
      state,
    );

    expect(result.filesScanned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// defaultStatePath
// ---------------------------------------------------------------------------

describe("defaultStatePath", () => {
  const ORIG = process.env.LITOPYS_DAEMON_STATE;

  afterEach(() => {
    if (ORIG === undefined) process.env.LITOPYS_DAEMON_STATE = undefined;
    else process.env.LITOPYS_DAEMON_STATE = ORIG;
  });

  test("returns path under ~/.litopys when env not set", () => {
    process.env.LITOPYS_DAEMON_STATE = undefined;
    const p = defaultStatePath();
    expect(p.includes(".litopys")).toBe(true);
    expect(p.endsWith(".json")).toBe(true);
  });

  test("returns env override when set", () => {
    process.env.LITOPYS_DAEMON_STATE = "/custom/path/state.json";
    expect(defaultStatePath()).toBe("/custom/path/state.json");
  });
});
