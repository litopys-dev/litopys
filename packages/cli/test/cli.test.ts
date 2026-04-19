import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Mock adapters before imports
// ---------------------------------------------------------------------------

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({ candidateNodes: [], candidateRelations: [] }),
          },
        ],
        usage: { input_tokens: 5, output_tokens: 3 },
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
              message: { content: JSON.stringify({ candidateNodes: [], candidateRelations: [] }) },
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        })),
      },
    };
  },
}));

process.env.ANTHROPIC_API_KEY = "sk-mock-cli-test";

const { writeQuarantineTo, listQuarantineFrom } = await import("@litopys/extractor");

describe("CLI quarantine commands", () => {
  let tmpDir: string;
  let graphDir: string;
  let qDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-cli-test-"));
    graphDir = path.join(tmpDir, "graph");
    qDir = path.join(tmpDir, "quarantine");
    await fs.mkdir(graphDir, { recursive: true });
    await fs.mkdir(qDir, { recursive: true });
    process.env.LITOPYS_GRAPH_PATH = graphDir;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    process.env.LITOPYS_GRAPH_PATH = undefined;
  });

  test("quarantine list shows no items on empty directory", async () => {
    const { execSync } = await import("node:child_process");
    // Just verify the function logic directly
    const { listQuarantine } = await import("@litopys/extractor");
    const items = await listQuarantine(graphDir);
    expect(items).toHaveLength(0);
  });

  test("quarantine list shows items after writing", async () => {
    await writeQuarantineTo(
      [
        {
          id: "cli-test-concept",
          type: "concept",
          summary: "CLI test concept",
          confidence: 0.8,
          reasoning: "Test",
          sourceSessionId: "test-sess",
        },
      ],
      [],
      {
        sessionId: "test-sess",
        timestamp: new Date().toISOString(),
        adapterName: "anthropic",
      },
      qDir,
    );

    const { listQuarantine } = await import("@litopys/extractor");
    const items = await listQuarantine(graphDir);
    // listQuarantine looks in graphDir/../quarantine = tmpDir/quarantine
    expect(items).toHaveLength(1);
    expect(items[0]?.candidates[0]?.id).toBe("cli-test-concept");
  });

  test("promoteCandidate works end-to-end", async () => {
    const candidateQDir = path.join(graphDir, "..", "quarantine");
    const filePath = await writeQuarantineTo(
      [
        {
          id: "promoted-cli",
          type: "system",
          summary: "Promoted via CLI",
          confidence: 0.9,
          reasoning: "Test",
          sourceSessionId: "sess",
        },
      ],
      [],
      { sessionId: "sess", timestamp: new Date().toISOString(), adapterName: "anthropic" },
      candidateQDir,
    );

    const { promoteCandidate } = await import("@litopys/extractor");
    await promoteCandidate(filePath, 0, graphDir);

    const systemFile = path.join(graphDir, "systems", "promoted-cli.md");
    const stat = await fs.stat(systemFile);
    expect(stat.isFile()).toBe(true);
  });

  test("rejectCandidate creates audit log", async () => {
    const candidateQDir = path.join(graphDir, "..", "quarantine");
    const filePath = await writeQuarantineTo(
      [
        {
          id: "rejected-cli",
          type: "concept",
          summary: "To be rejected",
          confidence: 0.3,
          reasoning: "Test",
          sourceSessionId: "sess",
        },
      ],
      [],
      { sessionId: "sess", timestamp: new Date().toISOString(), adapterName: "anthropic" },
      candidateQDir,
    );

    const { rejectCandidate } = await import("@litopys/extractor");
    await rejectCandidate(filePath, 0, graphDir, "not relevant for CLI test");

    const logPath = path.join(graphDir, "..", "quarantine", "rejected.jsonl");
    const content = await fs.readFile(logPath, "utf-8");
    expect(content).toContain("rejected-cli");
    expect(content).toContain("not relevant for CLI test");
  });
});

describe("CLI digest command", () => {
  let tmpDir: string;
  let graphDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-cli-digest-test-"));
    graphDir = path.join(tmpDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });
    process.env.LITOPYS_GRAPH_PATH = graphDir;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    process.env.LITOPYS_GRAPH_PATH = undefined;
  });

  test("digest generates file in digests directory", async () => {
    const { generateDigest } = await import("@litopys/extractor");
    const result = await generateDigest({ graphPath: graphDir });
    expect(result.content).toContain("Litopys Weekly Digest");

    const stat = await fs.stat(result.outputPath);
    expect(stat.isFile()).toBe(true);
  });
});

describe("CLI exports", () => {
  test("PACKAGE_NAME is correct", async () => {
    const { PACKAGE_NAME } = await import("../src/index.ts");
    expect(PACKAGE_NAME).toBe("@litopys/cli");
  });

  test("VERSION is correct", async () => {
    const { VERSION } = await import("../src/index.ts");
    expect(VERSION).toBe("0.1.0");
  });
});
