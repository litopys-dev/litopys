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

process.env.ANTHROPIC_API_KEY = "sk-mock-ingest-test";
process.env.LITOPYS_EXTRACTOR_PROVIDER = "anthropic";

const { runIngest, parseIngestArgs } = await import("../src/ingest.ts");
const { listQuarantineFrom } = await import("@litopys/extractor");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(import.meta.dir, "../../extractor/test/fixtures/sources");

// ---------------------------------------------------------------------------
// parseIngestArgs
// ---------------------------------------------------------------------------

describe("parseIngestArgs", () => {
  test("parses bare spec", () => {
    const result = parseIngestArgs(["text:/tmp/file.txt"]);
    expect(result?.spec).toBe("text:/tmp/file.txt");
    expect(result?.dryRun).toBe(false);
    expect(result?.provider).toBeUndefined();
    expect(result?.maxChunkBytes).toBeUndefined();
  });

  test("parses --dry-run flag", () => {
    const result = parseIngestArgs(["text:/tmp/file.txt", "--dry-run"]);
    expect(result?.dryRun).toBe(true);
  });

  test("parses --provider flag", () => {
    const result = parseIngestArgs(["jsonl:/tmp/chat.jsonl", "--provider", "ollama"]);
    expect(result?.provider).toBe("ollama");
  });

  test("parses --max-chunk-bytes flag", () => {
    const result = parseIngestArgs(["text:/tmp/big.txt", "--max-chunk-bytes", "50000"]);
    expect(result?.maxChunkBytes).toBe(50_000);
  });

  test("returns null for empty args (and writes to stderr)", () => {
    // Capture stderr
    const original = process.stderr.write.bind(process.stderr);
    const lines: string[] = [];
    process.stderr.write = (s: string) => { lines.push(s); return true; };
    try {
      const result = parseIngestArgs([]);
      expect(result).toBeNull();
      expect(lines.some((l) => l.includes("Usage"))).toBe(true);
    } finally {
      process.stderr.write = original;
    }
  });
});

// ---------------------------------------------------------------------------
// runIngest — integration tests with mocked LLM
// ---------------------------------------------------------------------------

describe("runIngest", () => {
  let tmpDir: string;
  let graphDir: string;
  let quarantineDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-ingest-test-"));
    graphDir = path.join(tmpDir, "graph");
    quarantineDir = path.join(tmpDir, "quarantine");
    await fs.mkdir(graphDir, { recursive: true });
    await fs.mkdir(quarantineDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("returns 0 files when no files match", async () => {
    const result = await runIngest(`text:${tmpDir}/no-such-file.txt`, {
      graphPath: graphDir,
    });
    expect(result.filesProcessed).toBe(0);
    expect(result.candidatesFound).toBe(0);
  });

  test("throws for unknown adapter prefix", async () => {
    await expect(
      runIngest("cursor:/tmp/session.jsonl", { graphPath: graphDir }),
    ).rejects.toThrow("No adapter found");
  });

  test("processes a text file and writes quarantine", async () => {
    const specPath = path.join(FIXTURE_DIR, "plain.txt");
    const result = await runIngest(`text:${specPath}`, { graphPath: graphDir });

    expect(result.filesProcessed).toBe(1);
    expect(result.candidatesFound).toBeGreaterThan(0); // mock returns 1 candidate
    expect(result.quarantineFiles).toHaveLength(1);

    // Verify quarantine file exists
    const qFile = result.quarantineFiles[0]!;
    const stat = await fs.stat(qFile);
    expect(stat.isFile()).toBe(true);

    // Verify quarantine content
    const qItems = await listQuarantineFrom(quarantineDir);
    expect(qItems).toHaveLength(1);
    expect(qItems[0]?.candidates[0]?.id).toBe("alice");
  });

  test("dry-run mode does not write quarantine files", async () => {
    const specPath = path.join(FIXTURE_DIR, "plain.txt");
    const result = await runIngest(`text:${specPath}`, {
      graphPath: graphDir,
      dryRun: true,
    });

    expect(result.filesProcessed).toBe(1);
    expect(result.quarantineFiles).toHaveLength(0);

    // Quarantine dir should be empty
    const qItems = await listQuarantineFrom(quarantineDir);
    expect(qItems).toHaveLength(0);
  });

  test("processes a jsonl file", async () => {
    const specPath = path.join(FIXTURE_DIR, "chat.jsonl");
    const result = await runIngest(`jsonl:${specPath}`, { graphPath: graphDir });
    expect(result.filesProcessed).toBe(1);
    expect(result.quarantineFiles).toHaveLength(1);
  });

  test("processes a claude-code JSONL file", async () => {
    const specPath = path.join(FIXTURE_DIR, "session.jsonl");
    const result = await runIngest(`claude-code:${specPath}`, { graphPath: graphDir });
    expect(result.filesProcessed).toBe(1);
    expect(result.quarantineFiles).toHaveLength(1);

    // Quarantine should reference sessionId from session.jsonl
    const qItems = await listQuarantineFrom(quarantineDir);
    expect(qItems).toHaveLength(1);
    expect(qItems[0]?.meta.sessionId).toBe("alice-session-001");
  });

  test("processes multiple files via glob", async () => {
    // Create two text files
    const fileA = path.join(tmpDir, "a.txt");
    const fileB = path.join(tmpDir, "b.txt");
    await fs.writeFile(fileA, "Alice is a senior engineer at Acme Corp.", "utf-8");
    await fs.writeFile(fileB, "Bob is a junior engineer at Acme Corp.", "utf-8");

    const result = await runIngest(`text:${tmpDir}/*.txt`, { graphPath: graphDir });
    expect(result.filesProcessed).toBe(2);
    expect(result.quarantineFiles).toHaveLength(2);
  });

  test("accumulates token counts across files", async () => {
    const fileA = path.join(tmpDir, "a.txt");
    const fileB = path.join(tmpDir, "b.txt");
    await fs.writeFile(fileA, "Alice from Acme.", "utf-8");
    await fs.writeFile(fileB, "Bob from Acme.", "utf-8");

    const result = await runIngest(`text:${tmpDir}/*.txt`, { graphPath: graphDir });
    // Mock returns 100 input tokens per call
    expect(result.inputTokensTotal).toBe(200);
    expect(result.outputTokensTotal).toBe(100);
  });

  test("respects --max-chunk-bytes for large files", async () => {
    // Create a file larger than a tiny chunk limit so it gets split into 2 chunks
    const longText = "Alice and Acme Corp.\n".repeat(30); // ~630 bytes
    const filePath = path.join(tmpDir, "long.txt");
    await fs.writeFile(filePath, longText, "utf-8");

    const result = await runIngest(`text:${filePath}`, {
      graphPath: graphDir,
      maxChunkBytes: 200, // force split into multiple chunks
    });

    expect(result.filesProcessed).toBe(1);
    // With 200 byte chunks, ~630 bytes → 4 chunks → 4 LLM calls → 4 candidates
    expect(result.candidatesFound).toBeGreaterThanOrEqual(2);
    expect(result.inputTokensTotal).toBeGreaterThan(100);
  });
});
