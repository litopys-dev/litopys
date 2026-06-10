import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MockAdapter } from "../src/adapters/mock.ts";
import type { ExtractorAdapter } from "../src/adapters/types.ts";
import { makeEpisodeId } from "../src/episode-store.ts";
import { runEpisodeStage } from "../src/session-end.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-episode-test-001";
// Fixed date that must come from the transcript timestamps, NOT from today
const FIXTURE_DATE = "2026-03-15";
const FIXTURE_MONTH = "2026-03";

/** Build a minimal JSONL transcript with timestamp fields set to FIXTURE_DATE. */
function makeFixtureTranscript(toolOpsCount = 6): string {
  const ts = `${FIXTURE_DATE}T10:00:00.000Z`;
  const events: object[] = [
    // First event with timestamp — sessionDateFromTranscript uses this
    {
      type: "user",
      sessionId: SESSION_ID,
      timestamp: ts,
      message: { role: "user", content: "перезапусти syut" },
    },
  ];

  // Add assistant/tool pairs to hit the minToolOps threshold
  for (let i = 0; i < toolOpsCount; i++) {
    const toolId = `t${i}`;
    events.push({
      type: "assistant",
      sessionId: SESSION_ID,
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
      sessionId: SESSION_ID,
      timestamp: ts,
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: toolId, content: "ok" },
        ],
      },
    });
  }

  return events.map((e) => JSON.stringify(e)).join("\n");
}

/** Build a mock adapter that returns one valid episode with given goal. */
function makeEpisodeAdapter(goal: string, toolOps = 7): MockAdapter {
  const mockResponse = JSON.stringify({
    episodes: [
      {
        goal,
        steps: [
          "проверить статус сервиса",
          "перезапустить юнит",
          "проверить логи",
        ],
        toolOps,
        errorRecovery: false,
        project: "syut",
        tags: ["deploy"],
      },
    ],
  });
  return new MockAdapter({ completions: [mockResponse] });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("runEpisodeStage", () => {
  let tmpDir: string;
  let episodesDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-ep-stage-"));
    episodesDir = path.join(tmpDir, "episodes");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  test("happy path: fixture transcript + mock adapter → writes 1 episode with date from transcript", async () => {
    const goal = "перезапуск syut";
    const transcript = makeFixtureTranscript(6);
    const adapter = makeEpisodeAdapter(goal);

    const written = await runEpisodeStage(transcript, SESSION_ID, adapter, {
      minToolOps: 5,
      episodesDir,
    });

    expect(written).toBe(1);

    // Monthly file must be named after FIXTURE_MONTH, NOT today's month
    const expectedFile = path.join(episodesDir, `${FIXTURE_MONTH}.jsonl`);
    const stat = await fs.stat(expectedFile);
    expect(stat.isFile()).toBe(true);

    // File must contain the episode with the fixture date
    const content = await fs.readFile(expectedFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);

    const ep = JSON.parse(lines[0]!) as {
      date: string;
      goal: string;
      sessionId: string;
      id: string;
    };
    expect(ep.date).toBe(FIXTURE_DATE);
    expect(ep.goal).toBe(goal);
    expect(ep.sessionId).toBe(SESSION_ID);
    expect(ep.id).toBe(makeEpisodeId(SESSION_ID, goal));
  });

  // -------------------------------------------------------------------------
  // Error resilience
  // -------------------------------------------------------------------------

  test("adapter throwing from complete() → returns 0, does not throw", async () => {
    const transcript = makeFixtureTranscript(6);

    // Adapter whose complete() always rejects
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

    let result: number | undefined;
    let threw = false;
    try {
      result = await runEpisodeStage(transcript, SESSION_ID, brokenAdapter, {
        minToolOps: 5,
        episodesDir,
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Empty transcript
  // -------------------------------------------------------------------------

  test("empty transcript → returns 0, no LLM call", async () => {
    const adapter = new MockAdapter({ completions: ['{"episodes":[{"goal":"x","steps":["a"],"toolOps":10,"errorRecovery":false,"project":null,"tags":[]}]}'] });

    const written = await runEpisodeStage("", SESSION_ID, adapter, {
      minToolOps: 5,
      episodesDir,
    });

    expect(written).toBe(0);
    expect(adapter.completeCalls).toBe(0);
  });

  test("whitespace-only transcript → returns 0, no LLM call", async () => {
    const adapter = new MockAdapter({ completions: ['{"episodes":[]}'] });

    const written = await runEpisodeStage("   \n\t  \n", SESSION_ID, adapter, {
      minToolOps: 5,
      episodesDir,
    });

    expect(written).toBe(0);
    expect(adapter.completeCalls).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Dedup — re-running same session must not create duplicate entries
  // -------------------------------------------------------------------------

  test("running episode stage twice for the same session → second run writes 0 (dedup)", async () => {
    const goal = "деплой приложения";
    const transcript = makeFixtureTranscript(6);

    const written1 = await runEpisodeStage(transcript, SESSION_ID, makeEpisodeAdapter(goal), {
      minToolOps: 5,
      episodesDir,
    });
    const written2 = await runEpisodeStage(transcript, SESSION_ID, makeEpisodeAdapter(goal), {
      minToolOps: 5,
      episodesDir,
    });

    expect(written1).toBe(1);
    expect(written2).toBe(0);

    // Only 1 line in file
    const content = await fs.readFile(
      path.join(episodesDir, `${FIXTURE_MONTH}.jsonl`),
      "utf-8",
    );
    const lines = content.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Import side-effect regression (entrypoint guard)
  // -------------------------------------------------------------------------

  test("importing session-end.ts does NOT run the hook (no failed stub written)", async () => {
    // Spawn a fresh bun process (clean module registry — an in-process dynamic
    // import() would hit the module cache and prove nothing) that merely
    // imports the module. With the import.meta.main guard the hook must not
    // run: no stdin read, no extraction, no quarantine/failed stub.
    const graphDir = path.join(tmpDir, "graph");
    const sessionEndPath = path.resolve(import.meta.dir, "../src/session-end.ts");

    // Strip ANTHROPIC_API_KEY so even a regressed (guard-less) module could
    // never fire a real paid API call from the test suite.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "ANTHROPIC_API_KEY") env[k] = v;
    }
    env.LITOPYS_GRAPH_PATH = graphDir;

    const proc = Bun.spawnSync({
      cmd: ["bun", "-e", `import ${JSON.stringify(sessionEndPath)}; console.log("imported-ok");`],
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("imported-ok");

    // The hook (if it had run) writes a failed stub to <graphPath>/../quarantine/failed
    const failedDir = path.join(tmpDir, "quarantine", "failed");
    const exists = await fs
      .stat(failedDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);

    // And no hook log output should appear on import
    expect(proc.stderr.toString()).not.toContain("[litopys/session-end]");
  });
});
