import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setAnthropicCreate, setOpenAICreate } from "../../../test-support/llm-sdk-mock.ts";

// The bench command only ever uses the deterministic "mock" extractor, but
// createAdapter() imports the Anthropic and OpenAI adapter modules eagerly —
// which in turn import @anthropic-ai/sdk / openai at the top level. The shared
// preload (test-support/llm-sdk-mock.ts) already stubs both SDKs before any
// test file runs, so no per-file mock.module calls are needed here.

beforeAll(() => {
  setAnthropicCreate(async () => ({
    content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 0, output_tokens: 0 },
  }));
  setOpenAICreate(async () => ({
    choices: [{ message: { content: "{}" } }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }));
});

afterAll(() => {
  setAnthropicCreate(null);
  setOpenAICreate(null);
});

const { cmdBench } = await import("../src/bench.ts");

describe("cmdBench (CLI)", () => {
  let tmpDir: string;
  let stdoutBuf: string[];
  let originalWrite: typeof process.stdout.write;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-bench-cli-"));
    stdoutBuf = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutBuf.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(async () => {
    process.stdout.write = originalWrite;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("writes report to --output target and prints markdown summary to stdout", async () => {
    const out = path.join(tmpDir, "report.json");
    await cmdBench(["--limit", "2", "--output", out]);
    const md = stdoutBuf.join("");
    expect(md).toContain("# Litopys benchmark — synthetic");
    expect(md).toContain("Provider: mock");

    const json = JSON.parse(await fs.readFile(out, "utf-8"));
    expect(json.dataset).toBe("synthetic");
    expect(json.total_questions).toBe(2);
    expect(json.k).toBe(5);
    expect(json.per_question).toHaveLength(2);
  });

  test("creates parent directories for --output if missing", async () => {
    const outFile = path.join(tmpDir, "nested", "subdir", "report.json");
    await cmdBench(["--limit", "1", "--output", outFile]);
    const exists = await fs
      .stat(outFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  test("rejects unknown flags", async () => {
    await expect(cmdBench(["--nope"])).rejects.toThrow(/Unknown argument/);
  });

  test("rejects --limit with non-positive or non-numeric value", async () => {
    const out = path.join(tmpDir, "r.json");
    await expect(cmdBench(["--limit", "0", "--output", out])).rejects.toThrow(/positive integer/);
    await expect(cmdBench(["--limit", "abc", "--output", out])).rejects.toThrow(/positive integer/);
  });

  test("rejects a flag without value", async () => {
    await expect(cmdBench(["--limit"])).rejects.toThrow(/requires a value/);
  });
});
