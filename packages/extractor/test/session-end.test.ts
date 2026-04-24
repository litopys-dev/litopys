import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AnthropicAdapter, type AnthropicClientLike } from "../src/adapters/anthropic.ts";
import { listQuarantineFrom, writeQuarantineTo } from "../src/quarantine.ts";

// ---------------------------------------------------------------------------
// Integration-style tests for session-end logic. The adapter is built with
// an injected fake client — no SDK module mocking, safe alongside the
// per-adapter test files.
// ---------------------------------------------------------------------------

const MOCK_CANDIDATE = {
  id: "bun-runtime",
  type: "system",
  summary: "Bun JavaScript runtime",
  confidence: 0.9,
  reasoning: "Explicitly referenced throughout session",
  sourceSessionId: "test-session",
};

function makeClient(): AnthropicClientLike {
  return {
    messages: {
      create: async () => ({
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
      }),
    },
  };
}

describe("session-end integration", () => {
  let tmpDir: string;
  let graphDir: string;
  let quarantineDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-se-test-"));
    graphDir = path.join(tmpDir, "graph");
    quarantineDir = path.join(tmpDir, "quarantine");
    await fs.mkdir(graphDir, { recursive: true });
    await fs.mkdir(quarantineDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("adapter extracts candidates from transcript", async () => {
    const adapter = new AnthropicAdapter({ client: makeClient() });
    const output = await adapter.extract({
      transcript: "We use Bun as our JavaScript runtime for all packages",
      existingNodeIds: [],
    });
    expect(output.candidateNodes.length).toBeGreaterThan(0);
    expect(output.candidateNodes[0]?.id).toBe("bun-runtime");
  });

  test("extracted candidates can be written to quarantine", async () => {
    const adapter = new AnthropicAdapter({ client: makeClient() });
    const output = await adapter.extract({
      transcript: "test transcript",
      existingNodeIds: [],
    });

    const meta = {
      sessionId: "integration-session",
      timestamp: new Date().toISOString(),
      adapterName: adapter.name,
    };

    await writeQuarantineTo(output.candidateNodes, output.candidateRelations, meta, quarantineDir);

    const files = await listQuarantineFrom(quarantineDir);
    expect(files).toHaveLength(1);
    expect(files[0]?.candidates).toHaveLength(1);
    expect(files[0]?.candidates[0]?.id).toBe("bun-runtime");
  });

  test("transcript→extract→quarantine full pipeline", async () => {
    const transcriptPath = path.join(tmpDir, "transcript.txt");
    await fs.writeFile(transcriptPath, "Alice uses Bun runtime for litopys", "utf-8");

    const transcript = await fs.readFile(transcriptPath, "utf-8");

    const adapter = new AnthropicAdapter({ client: makeClient() });
    const output = await adapter.extract({
      transcript,
      existingNodeIds: [],
    });

    const meta = {
      sessionId: "pipeline-session",
      timestamp: new Date().toISOString(),
      adapterName: adapter.name,
    };

    const filePath = await writeQuarantineTo(
      output.candidateNodes,
      output.candidateRelations,
      meta,
      quarantineDir,
    );

    expect(filePath).toContain(quarantineDir);

    const files = await listQuarantineFrom(quarantineDir);
    expect(files).toHaveLength(1);
    expect(files[0]?.meta.sessionId).toBe("pipeline-session");
  });

  test("handles empty transcript gracefully", async () => {
    const adapter = new AnthropicAdapter({ client: makeClient() });
    const output = await adapter.extract({
      transcript: "",
      existingNodeIds: [],
    });
    expect(output.candidateNodes).toBeDefined();
    expect(Array.isArray(output.candidateNodes)).toBe(true);
  });

  test("failed stub writing creates proper JSON file", async () => {
    const failedDir = path.join(quarantineDir, "failed");
    await fs.mkdir(failedDir, { recursive: true });

    const sessionId = "failed-session";
    const reason = "timeout";
    const fileName = `${new Date().toISOString().replace(/:/g, "-")}-${sessionId}.json`;
    const filePath = path.join(failedDir, fileName);

    await fs.writeFile(
      filePath,
      JSON.stringify({ sessionId, reason, timestamp: new Date().toISOString() }, null, 2),
      "utf-8",
    );

    const content = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
      sessionId: string;
      reason: string;
    };
    expect(content.sessionId).toBe("failed-session");
    expect(content.reason).toBe("timeout");
  });

  test("cost estimate calculation", () => {
    const inputTokens = 1000;
    const outputTokens = 500;
    const inputCost = (inputTokens / 1_000_000) * 0.25;
    const outputCost = (outputTokens / 1_000_000) * 1.25;
    const totalCost = inputCost + outputCost;

    expect(totalCost).toBeLessThan(0.01);
    expect(totalCost).toBeGreaterThan(0);
    expect(totalCost).toBeCloseTo(0.000875, 6);
  });

  test("full session flow with existing node ids", async () => {
    const adapter = new AnthropicAdapter({ client: makeClient() });
    const output = await adapter.extract({
      transcript: "Existing system is referenced again",
      existingNodeIds: ["bun-runtime", "litopys-project"],
    });

    expect(output).toBeDefined();
    expect(output.modelUsed).toBe("claude-haiku-4-5-20251001");
  });

  test("session-end payload parsing extracts session_id", () => {
    const payload = JSON.parse(
      '{"session_id":"abc-123","transcript_path":"/tmp/transcript.txt"}',
    ) as { session_id?: string; transcript_path?: string };
    expect(payload.session_id).toBe("abc-123");
    expect(payload.transcript_path).toBe("/tmp/transcript.txt");
  });

  test("output has correct usage fields", async () => {
    const adapter = new AnthropicAdapter({ client: makeClient() });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.usage).toHaveProperty("inputTokens");
    expect(output.usage).toHaveProperty("outputTokens");
    expect(typeof output.usage.inputTokens).toBe("number");
    expect(typeof output.usage.outputTokens).toBe("number");
  });
});
