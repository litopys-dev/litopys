/**
 * Tests for runEpisodesCatchup — daemon catch-up pass for episode extraction.
 */

// NOTE: All imports from packages that transitively load @anthropic-ai/sdk must
// be DYNAMIC (await import) placed AFTER mock.module() calls. Static imports are
// hoisted to the top of the ESM module before any module-level code executes, so
// a static `import { MockAdapter } from "@litopys/extractor"` would load the real
// SDK before mock.module() has a chance to intercept it, breaking daemon.test.ts
// whose mock.module() would find the SDK already loaded in the module cache.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Mock LLM SDKs — MUST come before any dynamic import of extractor / tick.
// Mirror the exact mocks used in daemon.test.ts so both test files work
// correctly when run together in the same bun test invocation.
// ---------------------------------------------------------------------------

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async () => ({
        content: [{ type: "text", text: '{"candidateNodes":[],"candidateRelations":[]}' }],
        usage: { input_tokens: 0, output_tokens: 0 },
      })),
    };
  },
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mock(async () => ({
          choices: [{ message: { content: '{"candidateNodes":[],"candidateRelations":[]}' } }],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        })),
      },
    };
  },
}));

// Save originals before mutating env (must happen at module level, before the
// dynamic imports below) — restored in afterAll so the mutation does not leak
// process-wide into other test files run in the same invocation.
const ORIG_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ORIG_EXTRACTOR_PROVIDER = process.env.LITOPYS_EXTRACTOR_PROVIDER;
process.env.ANTHROPIC_API_KEY = "sk-mock-episodes-catchup-test";
process.env.LITOPYS_EXTRACTOR_PROVIDER = "anthropic";

afterAll(() => {
  if (ORIG_ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIG_ANTHROPIC_API_KEY;
  if (ORIG_EXTRACTOR_PROVIDER === undefined) delete process.env.LITOPYS_EXTRACTOR_PROVIDER;
  else process.env.LITOPYS_EXTRACTOR_PROVIDER = ORIG_EXTRACTOR_PROVIDER;
});

// Lazy imports after mocking — order matters
const { runEpisodesCatchup } = await import("../src/tick.ts");
const { MockAdapter, AdapterCompleteError } = await import("@litopys/extractor");
import type { ExtractorAdapter } from "@litopys/extractor";
import type { DaemonState } from "../src/state.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): DaemonState {
  return { version: 1, sources: {} };
}

const FIXTURE_SESSION_ID = "sess-catchup-test-001";

/**
 * Build a minimal Claude Code JSONL transcript with timestamps and tool ops.
 * The first `errorResults` tool results are marked is_error (for testing the
 * errorCount >= 2 branch of the cheap filter).
 */
function makeFixtureTranscript(
  toolOpsCount: number,
  date = "2026-03-15",
  errorResults = 0,
  sessionId = FIXTURE_SESSION_ID,
): string {
  const ts = `${date}T10:00:00.000Z`;

  const events: object[] = [
    {
      type: "user",
      sessionId,
      timestamp: ts,
      message: { role: "user", content: "перезапусти syut" },
    },
  ];

  for (let i = 0; i < toolOpsCount; i++) {
    const toolId = `t${i}`;
    events.push({
      type: "assistant",
      sessionId,
      timestamp: ts,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: toolId,
            name: "Bash",
            input: { command: `systemctl status syut-${i}` },
          },
        ],
      },
    });
    const isError = i < errorResults;
    events.push({
      type: "user",
      sessionId,
      timestamp: ts,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolId,
            ...(isError ? { is_error: true } : {}),
            content: isError ? "Exit code 1: unit not found" : "ok",
          },
        ],
      },
    });
  }

  return events.map((e) => JSON.stringify(e)).join("\n");
}

/** Build a mock adapter that returns one valid episode when complete() is called. */
function makeEpisodeAdapter(goal = "перезапуск syut"): InstanceType<typeof MockAdapter> {
  const mockResponse = JSON.stringify({
    episodes: [
      {
        goal,
        steps: ["проверить статус сервиса", "перезапустить юнит", "проверить логи"],
        toolOps: 7,
        errorRecovery: false,
        project: "syut",
        tags: ["deploy"],
      },
    ],
  });
  return new MockAdapter({ completions: [mockResponse] });
}

/** Set file mtime to a given number of milliseconds ago. */
async function setMtimeAgo(filePath: string, msAgo: number): Promise<void> {
  const t = new Date(Date.now() - msAgo);
  await fs.utimes(filePath, t, t);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("runEpisodesCatchup", () => {
  let tmpDir: string;
  let episodesDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-catchup-test-"));
    episodesDir = path.join(tmpDir, "episodes");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Happy path: cooled-down file with enough tool ops → 1 episode written
  // -------------------------------------------------------------------------

  test("cooled-down file (mtime 2h ago), toolOps >= 5, mock returns 1 episode → filesProcessed 1, episodesFound 1, episode date from transcript timestamp", async () => {
    const filePath = path.join(tmpDir, "session.jsonl");
    const content = makeFixtureTranscript(6, "2026-03-15");
    await fs.writeFile(filePath, content, "utf-8");
    // Set mtime 2 hours ago
    await setMtimeAgo(filePath, 2 * 60 * 60 * 1000);

    const adapter = makeEpisodeAdapter("перезапуск syut");
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter,
        episodesDir,
        minAgeMs: 60_000, // 1 minute — file is 2h old so it qualifies
        minToolOps: 5,
      },
      state,
    );

    expect(result.filesProcessed).toBe(1);
    expect(result.episodesFound).toBe(1);

    // Episode must be in the file named after the transcript date, not today
    const expectedFile = path.join(episodesDir, "2026-03.jsonl");
    const stat = await fs.stat(expectedFile);
    expect(stat.isFile()).toBe(true);

    const lines = (await fs.readFile(expectedFile, "utf-8")).split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);

    const line0 = lines[0];
    const ep = JSON.parse(line0 as string) as { date: string; goal: string };
    expect(ep.date).toBe("2026-03-15");
    expect(ep.goal).toBe("перезапуск syut");
  });

  // -------------------------------------------------------------------------
  // mtime-date fallback: timestamp-less transcript → date from file mtime
  // -------------------------------------------------------------------------

  test("timestamp-less transcript → episode date falls back to file mtime date (2026-02-20 → 2026-02.jsonl)", async () => {
    const filePath = path.join(tmpDir, "no-timestamps.jsonl");
    // Build a transcript with NO timestamp fields anywhere
    const content = makeFixtureTranscript(6)
      .split("\n")
      .map((line) => {
        const ev = JSON.parse(line) as Record<string, unknown>;
        delete ev.timestamp;
        return JSON.stringify(ev);
      })
      .join("\n");
    await fs.writeFile(filePath, content, "utf-8");

    // Pin the mtime to a fixed past date — sessionDateFromTranscript returns
    // undefined, so the catch-up must use this mtime date, NOT today.
    const fixedMtime = new Date("2026-02-20T14:30:00.000Z");
    await fs.utimes(filePath, fixedMtime, fixedMtime);

    const adapter = makeEpisodeAdapter("работа без таймстампов");
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );

    expect(result.filesProcessed).toBe(1);
    expect(result.episodesFound).toBe(1);

    // Episode must land in the monthly file derived from the file mtime
    const expectedFile = path.join(episodesDir, "2026-02.jsonl");
    const lines = (await fs.readFile(expectedFile, "utf-8")).split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);

    const line0 = lines[0];
    const ep = JSON.parse(line0 as string) as { date: string; goal: string };
    expect(ep.date).toBe("2026-02-20");
    expect(ep.goal).toBe("работа без таймстампов");
  });

  // -------------------------------------------------------------------------
  // Idempotency: repeated call without file change → filesProcessed 0
  // -------------------------------------------------------------------------

  test("second call with same file mtime → filesProcessed 0 (episodesState dedup)", async () => {
    const filePath = path.join(tmpDir, "session.jsonl");
    const content = makeFixtureTranscript(6, "2026-03-15");
    await fs.writeFile(filePath, content, "utf-8");
    await setMtimeAgo(filePath, 2 * 60 * 60 * 1000);

    const state = freshState();

    // First call — processes the file
    const r1 = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter: makeEpisodeAdapter(),
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );
    expect(r1.filesProcessed).toBe(1);

    // Second call — same mtime recorded in state, should skip
    const r2 = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter: makeEpisodeAdapter(),
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );
    expect(r2.filesProcessed).toBe(0);
    expect(r2.episodesFound).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Fresh file (mtime = now) → not processed
  // -------------------------------------------------------------------------

  test("fresh file (mtime ≈ now) → not touched (not cooled down)", async () => {
    const filePath = path.join(tmpDir, "fresh.jsonl");
    const content = makeFixtureTranscript(6);
    await fs.writeFile(filePath, content, "utf-8");
    // Leave mtime as-is (just created = now)

    const adapter = makeEpisodeAdapter();
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter,
        episodesDir,
        minAgeMs: 3_600_000, // 1 hour — file was just created
        minToolOps: 5,
      },
      state,
    );

    expect(result.filesProcessed).toBe(0);
    expect(result.episodesFound).toBe(0);
    expect(adapter.completeCalls).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Low toolOps → LLM NOT called, but file marked processed
  // -------------------------------------------------------------------------

  test("toolOps 2, errorCount 0 → LLM not called (completeCalls 0), file marked processed", async () => {
    const filePath = path.join(tmpDir, "low-ops.jsonl");
    const content = makeFixtureTranscript(2); // only 2 tool ops
    await fs.writeFile(filePath, content, "utf-8");
    await setMtimeAgo(filePath, 2 * 60 * 60 * 1000);

    const adapter = makeEpisodeAdapter();
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );

    expect(adapter.completeCalls).toBe(0); // LLM not called
    expect(result.filesProcessed).toBe(1); // but file IS marked processed
    expect(result.episodesFound).toBe(0);

    // Verify episodesState was updated (file won't be retried)
    expect(state.episodesState).toBeDefined();
    expect(state.episodesState?.[filePath]).toBeDefined();

    // Repeated call must not touch the file again
    const r2 = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );
    expect(r2.filesProcessed).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Adapter throws → file NOT marked, function does not throw
  // -------------------------------------------------------------------------

  test("adapter throws on complete() → file NOT marked processed, does not throw, filesProcessed 0", async () => {
    const filePath = path.join(tmpDir, "throwing.jsonl");
    const content = makeFixtureTranscript(6);
    await fs.writeFile(filePath, content, "utf-8");
    await setMtimeAgo(filePath, 2 * 60 * 60 * 1000);

    const brokenAdapter: ExtractorAdapter = {
      name: "broken-mock",
      model: "broken",
      extract: async () => ({
        candidateNodes: [],
        candidateRelations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        modelUsed: "broken",
      }),
      complete: async () => {
        throw new Error("LLM exploded");
      },
    };

    const state = freshState();

    let threw = false;
    let result: { filesProcessed: number; episodesFound: number } | undefined;
    try {
      result = await runEpisodesCatchup(
        {
          sources: [{ adapter: "claude-code", glob: filePath }],
          adapter: brokenAdapter,
          episodesDir,
          minAgeMs: 60_000,
          minToolOps: 5,
        },
        state,
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result?.filesProcessed).toBe(0); // file NOT marked (error path)
    expect(result?.episodesFound).toBe(0);

    // episodesState must NOT contain the file (so it retries next tick)
    expect(state.episodesState?.[filePath]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Non-claude-code adapters are ignored
  // -------------------------------------------------------------------------

  test("non-claude-code adapter source is ignored entirely", async () => {
    const filePath = path.join(tmpDir, "chat.jsonl");
    await fs.writeFile(filePath, '{"role":"user","content":"hello"}\n', "utf-8");
    await setMtimeAgo(filePath, 2 * 60 * 60 * 1000);

    const adapter = makeEpisodeAdapter();
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [{ adapter: "jsonl", glob: filePath }], // NOT claude-code
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );

    expect(result.filesProcessed).toBe(0);
    expect(adapter.completeCalls).toBe(0);
  });

  // -------------------------------------------------------------------------
  // episodesState survives serialisation round-trip (JSON.stringify/parse)
  // -------------------------------------------------------------------------

  test("episodesState persists through JSON serialisation (state round-trip)", async () => {
    const filePath = path.join(tmpDir, "session.jsonl");
    const content = makeFixtureTranscript(6, "2026-03-15");
    await fs.writeFile(filePath, content, "utf-8");
    await setMtimeAgo(filePath, 2 * 60 * 60 * 1000);

    const state = freshState();

    await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter: makeEpisodeAdapter(),
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );

    // Simulate state serialisation/deserialisation (as done by saveState/loadState)
    const serialised = JSON.stringify(state);
    const restored = JSON.parse(serialised) as DaemonState;

    // episodesState must survive the round-trip
    expect(restored.episodesState).toBeDefined();
    expect(restored.episodesState?.[filePath]).toBeDefined();
    expect(typeof restored.episodesState?.[filePath]?.mtime).toBe("string");

    // Using restored state: repeated call must not process the file again
    const r2 = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter: makeEpisodeAdapter(),
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      restored,
    );
    expect(r2.filesProcessed).toBe(0);
  });

  // -------------------------------------------------------------------------
  // sessionId guard — hook/catch-up double extraction protection
  // -------------------------------------------------------------------------

  test("session already in episode store (by sessionId) → file marked processed, LLM not called", async () => {
    const filePath = path.join(tmpDir, "hooked-session.jsonl");
    const content = makeFixtureTranscript(6, "2026-03-15");
    await fs.writeFile(filePath, content, "utf-8");
    await setMtimeAgo(filePath, 2 * 60 * 60 * 1000);

    // Pre-write an episode with the fixture's sessionId into the target
    // monthly file — as if the SessionEnd hook already processed the session.
    await fs.mkdir(episodesDir, { recursive: true });
    const hookEpisode = {
      id: "ep-hook12345678",
      sessionId: FIXTURE_SESSION_ID,
      date: "2026-03-15",
      goal: "уже извлечено хуком",
      steps: ["шаг один"],
      toolOps: 6,
      errorRecovery: false,
      project: null,
      tags: [],
      clusteredInto: null,
    };
    await fs.writeFile(
      path.join(episodesDir, "2026-03.jsonl"),
      `${JSON.stringify(hookEpisode)}\n`,
      "utf-8",
    );

    const adapter = makeEpisodeAdapter();
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );

    expect(adapter.completeCalls).toBe(0); // LLM NOT called — hook already did the work
    expect(result.filesProcessed).toBe(1); // file IS marked processed
    expect(result.episodesFound).toBe(0);
    expect(state.episodesState?.[filePath]).toBeDefined();

    // Monthly file untouched: still exactly the one hook-written episode
    const lines = (await fs.readFile(path.join(episodesDir, "2026-03.jsonl"), "utf-8"))
      .split("\n")
      .filter((l) => l.trim());
    expect(lines).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Dry-run — zero side effects
  // -------------------------------------------------------------------------

  test("dryRun: no LLM calls, no episode writes, no episodesState mutation, zero counts", async () => {
    const filePath = path.join(tmpDir, "dry-run.jsonl");
    const content = makeFixtureTranscript(6, "2026-03-15");
    await fs.writeFile(filePath, content, "utf-8");
    await setMtimeAgo(filePath, 2 * 60 * 60 * 1000);

    const adapter = makeEpisodeAdapter();
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
        dryRun: true,
      },
      state,
    );

    // Zero counts returned
    expect(result.filesProcessed).toBe(0);
    expect(result.episodesFound).toBe(0);

    // No LLM call
    expect(adapter.completeCalls).toBe(0);

    // No episodesState mutation (not even initialisation)
    expect(state.episodesState).toBeUndefined();

    // No episode files written
    const episodesDirExists = await fs
      .stat(episodesDir)
      .then(() => true)
      .catch(() => false);
    expect(episodesDirExists).toBe(false);

    // A subsequent real run must still process the file (dry-run left no trace)
    const realResult = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );
    expect(realResult.filesProcessed).toBe(1);
    expect(realResult.episodesFound).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Circuit breaker: AdapterCompleteError → pass aborted, file NOT marked
  // -------------------------------------------------------------------------

  test("AdapterCompleteError on first file → pass aborted (break), both files NOT marked, function does not throw", async () => {
    // Two files — the first one causes an AdapterCompleteError.
    // Expected: pass aborts after first file, NEITHER file is marked processed.
    const file1 = path.join(tmpDir, "session1.jsonl");
    const file2 = path.join(tmpDir, "session2.jsonl");
    // Use distinct session IDs to prevent the sessionId guard from skipping file2
    await fs.writeFile(file1, makeFixtureTranscript(6, "2026-03-15", 0, "sess-cb-001"), "utf-8");
    await fs.writeFile(file2, makeFixtureTranscript(6, "2026-03-16", 0, "sess-cb-002"), "utf-8");
    await setMtimeAgo(file1, 2 * 60 * 60 * 1000);
    await setMtimeAgo(file2, 2 * 60 * 60 * 1000);

    const apiErrorAdapter = new MockAdapter({
      failWith: new Error("HTTP 429 Too Many Requests"),
    });

    const state = freshState();
    let threw = false;
    let result: { filesProcessed: number; episodesFound: number } | undefined;
    try {
      result = await runEpisodesCatchup(
        {
          sources: [
            { adapter: "claude-code", glob: file1 },
            { adapter: "claude-code", glob: file2 },
          ],
          adapter: apiErrorAdapter,
          episodesDir,
          minAgeMs: 60_000,
          minToolOps: 5,
        },
        state,
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(false); // runEpisodesCatchup never throws
    expect(result?.filesProcessed).toBe(0); // neither file marked
    expect(result?.episodesFound).toBe(0);

    // Neither file must be in episodesState (both get retried next tick)
    expect(state.episodesState?.[file1]).toBeUndefined();
    expect(state.episodesState?.[file2]).toBeUndefined();

    // Only 1 complete() call — circuit break after first file
    expect(apiErrorAdapter.completeCalls).toBe(1);
  });

  test("non-AdapterCompleteError → file skipped but pass continues to next file", async () => {
    // File 1 will fail with a non-API error (parse error from transcript)
    // File 2 should still be processed.
    // We simulate this by making file1 unparseable as a transcript.
    const file1 = path.join(tmpDir, "corrupt.jsonl");
    const file2 = path.join(tmpDir, "valid.jsonl");

    // File 1 has valid toolOps but the adapter for file1 fails with a non-API error.
    // We'll use an adapter that throws a regular Error on first call, succeeds on second.
    // Use distinct session IDs so the sessionId guard doesn't affect test outcome.
    await fs.writeFile(file1, makeFixtureTranscript(6, "2026-03-15", 0, "sess-nc-001"), "utf-8");
    await fs.writeFile(file2, makeFixtureTranscript(6, "2026-03-16", 0, "sess-nc-002"), "utf-8");
    await setMtimeAgo(file1, 2 * 60 * 60 * 1000);
    await setMtimeAgo(file2, 2 * 60 * 60 * 1000);

    let callCount = 0;
    const goodResponse = JSON.stringify({
      episodes: [
        {
          goal: "второй файл",
          steps: ["шаг один", "шаг два", "шаг три"],
          toolOps: 6,
          errorRecovery: false,
          project: null,
          tags: [],
        },
      ],
    });
    const mixedAdapter: ExtractorAdapter = {
      name: "mixed",
      model: "test",
      extract: async () => ({
        candidateNodes: [],
        candidateRelations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        modelUsed: "test",
      }),
      complete: async (input) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("generic parse error"); // NOT AdapterCompleteError
        }
        return { text: goodResponse, usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };

    const state = freshState();
    const result = await runEpisodesCatchup(
      {
        sources: [
          { adapter: "claude-code", glob: file1 },
          { adapter: "claude-code", glob: file2 },
        ],
        adapter: mixedAdapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );

    // File1 errored (non-API) → skipped but pass continued
    // File2 succeeded → marked processed, 1 episode found
    expect(result.filesProcessed).toBe(1); // only file2
    expect(result.episodesFound).toBe(1);
    expect(state.episodesState?.[file1]).toBeUndefined(); // not marked (error)
    expect(state.episodesState?.[file2]).toBeDefined(); // marked
    expect(callCount).toBe(2); // both files attempted
  });

  // -------------------------------------------------------------------------
  // LLM budget: maxLlmFilesPerTick limits how many files get LLM calls
  // -------------------------------------------------------------------------

  test("maxLlmFilesPerTick=1 with 2 LLM-worthy files → only 1 processed, 1 deferred", async () => {
    const file1 = path.join(tmpDir, "budget1.jsonl");
    const file2 = path.join(tmpDir, "budget2.jsonl");
    // Use distinct session IDs so the session guard does not fire on file2
    await fs.writeFile(
      file1,
      makeFixtureTranscript(6, "2026-03-15", 0, "sess-budget-001"),
      "utf-8",
    );
    await fs.writeFile(
      file2,
      makeFixtureTranscript(6, "2026-03-16", 0, "sess-budget-002"),
      "utf-8",
    );
    await setMtimeAgo(file1, 2 * 60 * 60 * 1000);
    await setMtimeAgo(file2, 2 * 60 * 60 * 1000);

    const adapter = makeEpisodeAdapter("эпизод бюджета");
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [
          { adapter: "claude-code", glob: file1 },
          { adapter: "claude-code", glob: file2 },
        ],
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
        maxLlmFilesPerTick: 1,
      },
      state,
    );

    // Only 1 file processed (budget = 1)
    expect(result.filesProcessed).toBe(1);
    expect(adapter.completeCalls).toBe(1); // only 1 LLM call

    // Exactly one of the two files is marked; the other is deferred
    const marked1 = state.episodesState?.[file1] !== undefined;
    const marked2 = state.episodesState?.[file2] !== undefined;
    expect(marked1 || marked2).toBe(true); // at least one marked
    expect(marked1 && marked2).toBe(false); // not both marked (budget enforced)
  });

  test("cheap pre-filters (toolOps < min) do NOT count against LLM budget", async () => {
    // File 1: low toolOps (cheap skip) → does NOT count against budget
    // File 2: high toolOps → reaches LLM (budget not yet exceeded)
    const file1 = path.join(tmpDir, "cheap.jsonl");
    const file2 = path.join(tmpDir, "llm.jsonl");
    // Use distinct session IDs to prevent session guard interactions
    await fs.writeFile(file1, makeFixtureTranscript(2, "2026-03-15", 0, "sess-cheap-001"), "utf-8"); // toolOps=2 < 5
    await fs.writeFile(file2, makeFixtureTranscript(6, "2026-03-16", 0, "sess-cheap-002"), "utf-8"); // toolOps=6 >= 5
    await setMtimeAgo(file1, 2 * 60 * 60 * 1000);
    await setMtimeAgo(file2, 2 * 60 * 60 * 1000);

    const adapter = makeEpisodeAdapter("основной эпизод");
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [
          { adapter: "claude-code", glob: file1 },
          { adapter: "claude-code", glob: file2 },
        ],
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
        maxLlmFilesPerTick: 1, // only 1 LLM call allowed
      },
      state,
    );

    // Both files processed: file1 via cheap path, file2 via LLM
    expect(result.filesProcessed).toBe(2);
    expect(adapter.completeCalls).toBe(1); // only file2 calls LLM
    expect(state.episodesState?.[file1]).toBeDefined(); // cheap-marked
    expect(state.episodesState?.[file2]).toBeDefined(); // LLM-marked
  });

  // -------------------------------------------------------------------------
  // Cheap filter: toolOps < min but errorCount >= 2 → still reaches the LLM
  // -------------------------------------------------------------------------

  test("toolOps 2 but errorCount 2 → LLM IS called (error-recovery sessions pass the cheap filter)", async () => {
    const filePath = path.join(tmpDir, "error-recovery.jsonl");
    // 2 tool ops, both results are errors → toolOps < 5 but errorCount >= 2
    const content = makeFixtureTranscript(2, "2026-03-15", 2);
    await fs.writeFile(filePath, content, "utf-8");
    await setMtimeAgo(filePath, 2 * 60 * 60 * 1000);

    const adapter = makeEpisodeAdapter();
    const state = freshState();

    const result = await runEpisodesCatchup(
      {
        sources: [{ adapter: "claude-code", glob: filePath }],
        adapter,
        episodesDir,
        minAgeMs: 60_000,
        minToolOps: 5,
      },
      state,
    );

    expect(adapter.completeCalls).toBeGreaterThan(0); // LLM reached
    expect(result.filesProcessed).toBe(1);
  });
});
