import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Mock adapters BEFORE any imports that load them
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
        usage: { input_tokens: 10, output_tokens: 5 },
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

// Set a fake API key so AnthropicAdapter doesn't throw
process.env.ANTHROPIC_API_KEY = "sk-mock-test-key";

// Import AFTER mocking
const { generateDigest } = await import("../src/digest.ts");
const { writeQuarantineTo } = await import("../src/quarantine.ts");
const { writeNode } = await import("@litopys/core");

describe("generateDigest", () => {
  let tmpDir: string;
  let graphDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-digest-test-"));
    graphDir = path.join(tmpDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("generates digest file", async () => {
    const result = await generateDigest({ graphPath: graphDir });
    expect(result.weekLabel).toMatch(/^\d{4}-W\d{2}$/);
    expect(result.outputPath).toContain("digests");
    expect(result.content).toBeTruthy();
  });

  test("output file is written to disk", async () => {
    const result = await generateDigest({ graphPath: graphDir });
    const stat = await fs.stat(result.outputPath);
    expect(stat.isFile()).toBe(true);
  });

  test("digest contains required sections", async () => {
    const result = await generateDigest({ graphPath: graphDir });
    expect(result.content).toContain("## What Was Updated This Week");
    expect(result.content).toContain("## Pending Quarantine Review");
    expect(result.content).toContain("## Rejections");
    expect(result.content).toContain("## Recommended Actions");
  });

  test("digest includes recent nodes when graph has content", async () => {
    // Write a node to the graph
    const today = new Date().toISOString().slice(0, 10);
    await writeNode(graphDir, {
      id: "test-system",
      type: "system",
      summary: "Test infrastructure system",
      updated: today,
      confidence: 0.9,
    });

    const result = await generateDigest({ graphPath: graphDir });
    expect(result.content).toContain("test-system");
  });

  test("digest includes pending quarantine count", async () => {
    const qDir = path.join(graphDir, "..", "quarantine");
    await writeQuarantineTo(
      [
        {
          id: "pending-concept",
          type: "concept",
          summary: "Pending review concept",
          confidence: 0.7,
          reasoning: "Found in session",
          sourceSessionId: "sess-001",
        },
      ],
      [],
      {
        sessionId: "sess-001",
        timestamp: new Date().toISOString(),
        adapterName: "anthropic",
      },
      qDir,
    );

    const result = await generateDigest({ graphPath: graphDir });
    expect(result.content).toContain("quarantine");
  });

  test("digest suggests hook setup when graph is empty", async () => {
    const result = await generateDigest({ graphPath: graphDir });
    expect(result.content).toContain("SessionEnd");
  });

  test("week label matches ISO week format", async () => {
    const result = await generateDigest({ graphPath: graphDir });
    expect(result.weekLabel).toMatch(/^\d{4}-W\d{2}$/);
  });

  test("respects weekDays option", async () => {
    // Should work with custom week length
    const result = await generateDigest({ graphPath: graphDir, weekDays: 30 });
    expect(result.content).toBeTruthy();
  });

  test("digest handles missing graph directory gracefully", async () => {
    const nonExistentGraph = path.join(tmpDir, "nonexistent", "graph");
    // Should not throw, just produce empty digest
    const result = await generateDigest({ graphPath: nonExistentGraph });
    expect(result.content).toContain("## What Was Updated This Week");
  });

  test("file is named by ISO week", async () => {
    const result = await generateDigest({ graphPath: graphDir });
    expect(path.basename(result.outputPath)).toBe(`${result.weekLabel}.md`);
  });

  test("multiple digests for same week overwrite previous", async () => {
    await generateDigest({ graphPath: graphDir });
    await generateDigest({ graphPath: graphDir });

    const digestsDir = path.join(graphDir, "..", "digests");
    const files = await fs.readdir(digestsDir);
    expect(files.length).toBe(1);
  });

  test("digest header includes week label", async () => {
    const result = await generateDigest({ graphPath: graphDir });
    expect(result.content).toContain(result.weekLabel);
  });
});
