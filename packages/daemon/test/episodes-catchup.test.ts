/**
 * Tests for runEpisodesCatchup — daemon catch-up pass for episode extraction.
 */

// NOTE: All imports from packages that transitively load @anthropic-ai/sdk must
// be DYNAMIC (await import) placed AFTER mock.module() calls. Static imports are
// hoisted to the top of the ESM module before any module-level code executes, so
// a static `import { MockAdapter } from "@litopys/extractor"` would load the real
// SDK before mock.module() has a chance to intercept it, breaking daemon.test.ts
// whose mock.module() would find the SDK already loaded in the module cache.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
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

process.env.ANTHROPIC_API_KEY = "sk-mock-episodes-catchup-test";
process.env.LITOPYS_EXTRACTOR_PROVIDER = "anthropic";

// Lazy imports after mocking — order matters
const { runEpisodesCatchup } = await import("../src/tick.ts");
const { MockAdapter } = await import("@litopys/extractor");
import type { ExtractorAdapter } from "@litopys/extractor";
import type { DaemonState } from "../src/state.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): DaemonState {
  return { version: 1, sources: {} };
}

/** Build a minimal Claude Code JSONL transcript with timestamps and tool ops. */
function makeFixtureTranscript(toolOpsCount: number, date = "2026-03-15"): string {
  const ts = `${date}T10:00:00.000Z`;
  const sessionId = "sess-catchup-test-001";

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
    events.push({
      type: "user",
      sessionId,
      timestamp: ts,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolId, content: "ok" }],
      },
    });
  }

  return events.map((e) => JSON.stringify(e)).join("\n");
}

/** Build a mock adapter that returns one valid episode when complete() is called. */
function makeEpisodeAdapter(goal = "перезапуск syut"): MockAdapter {
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

    const lines = (await fs.readFile(expectedFile, "utf-8"))
      .split("\n")
      .filter((l) => l.trim());
    expect(lines).toHaveLength(1);

    const ep = JSON.parse(lines[0]!) as { date: string; goal: string };
    expect(ep.date).toBe("2026-03-15");
    expect(ep.goal).toBe("перезапуск syut");
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
    expect(state.episodesState![filePath]).toBeDefined();

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
    expect(restored.episodesState![filePath]).toBeDefined();
    expect(typeof restored.episodesState![filePath]!.mtime).toBe("string");

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
});
