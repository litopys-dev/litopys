import { describe, expect, test } from "bun:test";
import { OpenAIAdapter, type OpenAIClientLike } from "../../src/adapters/openai.ts";
import type { ExtractorInput } from "../../src/adapters/types.ts";

// ---------------------------------------------------------------------------
// Tests use constructor-level dependency injection (client option) so they
// don't touch the module registry — safe to mix with other adapter tests.
// ---------------------------------------------------------------------------

function fakeClient(
  response: {
    choices: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  },
  throwError?: Error,
): OpenAIClientLike {
  return {
    chat: {
      completions: {
        create: async () => {
          if (throwError) throw throwError;
          return response;
        },
      },
    },
  };
}

describe("OpenAIAdapter", () => {
  test("throws if OPENAI_API_KEY not set", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = undefined;
    expect(() => new OpenAIAdapter()).toThrow("OPENAI_API_KEY");
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
  });

  test("does not throw when only baseURL is provided (uses 'none' as apiKey)", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = undefined;
    expect(() => new OpenAIAdapter({ baseURL: "http://localhost:8080/v1" })).not.toThrow();
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
  });

  test("reads baseURL from LITOPYS_EXTRACTOR_BASE_URL env", () => {
    const originalKey = process.env.OPENAI_API_KEY;
    const originalBase = process.env.LITOPYS_EXTRACTOR_BASE_URL;
    process.env.OPENAI_API_KEY = undefined;
    process.env.LITOPYS_EXTRACTOR_BASE_URL = "http://myserver:8080/v1";
    expect(() => new OpenAIAdapter()).not.toThrow();
    process.env.LITOPYS_EXTRACTOR_BASE_URL = originalBase;
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
  });

  test("uses provided apiKey option", () => {
    expect(() => new OpenAIAdapter({ apiKey: "sk-openai-test" })).not.toThrow();
  });

  test("defaults to gpt-4o-mini model", () => {
    const adapter = new OpenAIAdapter({ apiKey: "sk-test" });
    expect(adapter.model).toBe("gpt-4o-mini");
  });

  test("uses custom model if provided", () => {
    const adapter = new OpenAIAdapter({ apiKey: "sk-test", model: "gpt-4o" });
    expect(adapter.model).toBe("gpt-4o");
  });

  test("adapter name is 'openai'", () => {
    const adapter = new OpenAIAdapter({ apiKey: "sk-test" });
    expect(adapter.name).toBe("openai");
  });

  test("accepts injected client without apiKey", () => {
    const client = fakeClient({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    });
    expect(() => new OpenAIAdapter({ client })).not.toThrow();
  });

  test("extract returns parsed candidates and relations", async () => {
    const client = fakeClient({
      choices: [
        {
          message: {
            content: JSON.stringify({
              candidateNodes: [
                {
                  id: "bun-runtime",
                  type: "system",
                  summary: "Bun JavaScript runtime",
                  confidence: 0.85,
                  reasoning: "Session repeatedly references Bun as the primary runtime",
                  sourceSessionId: "test-session",
                },
              ],
              candidateRelations: [
                {
                  type: "uses",
                  sourceId: "litopys-project",
                  targetId: "bun-runtime",
                  confidence: 0.9,
                  reasoning: "Package.json and scripts all use bun commands",
                  sourceSessionId: "test-session",
                },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 200, completion_tokens: 80 },
    });
    const adapter = new OpenAIAdapter({ client });
    const input: ExtractorInput = {
      transcript: "We use Bun for everything in the litopys project",
      existingNodeIds: ["litopys-project"],
    };
    const output = await adapter.extract(input);
    expect(output.candidateNodes).toHaveLength(1);
    expect(output.candidateNodes[0]?.id).toBe("bun-runtime");
    expect(output.candidateNodes[0]?.type).toBe("system");
    expect(output.candidateRelations).toHaveLength(1);
    expect(output.candidateRelations[0]?.type).toBe("uses");
    expect(output.usage.inputTokens).toBe(200);
    expect(output.usage.outputTokens).toBe(80);
  });

  test("extract handles invalid JSON gracefully", async () => {
    const client = fakeClient({
      choices: [{ message: { content: "{ this is not json" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const adapter = new OpenAIAdapter({ client });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.candidateRelations).toHaveLength(0);
  });

  test("extract reports an API error as a failure, not as an empty extraction", async () => {
    const client = fakeClient(
      { choices: [] },
      new Error("OpenAI API error: 429 Too Many Requests"),
    );
    const adapter = new OpenAIAdapter({ client });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.usage.inputTokens).toBe(0);
    expect(output.usage.outputTokens).toBe(0);
    // Callers advance their read offset on success; an unflagged empty result
    // here would silently discard the transcript.
    expect(output.failure?.kind).toBe("api");
    expect(output.failure?.message).toContain("429");
  });

  test("handles missing usage gracefully", async () => {
    const client = fakeClient({
      choices: [
        { message: { content: JSON.stringify({ candidateNodes: [], candidateRelations: [] }) } },
      ],
      usage: undefined,
    });
    const adapter = new OpenAIAdapter({ client });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.usage.inputTokens).toBe(0);
    expect(output.usage.outputTokens).toBe(0);
  });
});

describe("OpenAIAdapter extraBody", () => {
  function capturingClient(calls: Array<Record<string, unknown>>): OpenAIClientLike {
    return {
      chat: {
        completions: {
          create: async (params: unknown) => {
            calls.push(params as Record<string, unknown>);
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({ candidateNodes: [], candidateRelations: [] }),
                  },
                },
              ],
            };
          },
        },
      },
    };
  }

  const NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

  test("merges extraBody into extract() and complete() requests", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = new OpenAIAdapter({ client: capturingClient(calls), extraBody: NO_THINK });
    await adapter.extract({ transcript: "test", existingNodeIds: [] });
    await adapter.complete({ prompt: "hi" });
    expect(calls).toHaveLength(2);
    for (const params of calls) {
      expect(params.chat_template_kwargs).toEqual({ enable_thinking: false });
    }
  });

  test("extraBody cannot override model", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = new OpenAIAdapter({
      client: capturingClient(calls),
      model: "real-model",
      extraBody: { model: "other-model" },
    });
    await adapter.complete({ prompt: "hi" });
    expect(calls[0]?.model).toBe("real-model");
  });

  test("reads extraBody from LITOPYS_EXTRACTOR_EXTRA_BODY env", async () => {
    const original = process.env.LITOPYS_EXTRACTOR_EXTRA_BODY;
    process.env.LITOPYS_EXTRACTOR_EXTRA_BODY = JSON.stringify(NO_THINK);
    try {
      const calls: Array<Record<string, unknown>> = [];
      const adapter = new OpenAIAdapter({ client: capturingClient(calls) });
      await adapter.complete({ prompt: "hi" });
      expect(calls[0]?.chat_template_kwargs).toEqual({ enable_thinking: false });
    } finally {
      process.env.LITOPYS_EXTRACTOR_EXTRA_BODY = original;
    }
  });

  test("rejects invalid LITOPYS_EXTRACTOR_EXTRA_BODY", () => {
    const original = process.env.LITOPYS_EXTRACTOR_EXTRA_BODY;
    const client = capturingClient([]);
    try {
      process.env.LITOPYS_EXTRACTOR_EXTRA_BODY = "{not json";
      expect(() => new OpenAIAdapter({ client })).toThrow("not valid JSON");
      process.env.LITOPYS_EXTRACTOR_EXTRA_BODY = "[1,2]";
      expect(() => new OpenAIAdapter({ client })).toThrow("must be a JSON object");
    } finally {
      process.env.LITOPYS_EXTRACTOR_EXTRA_BODY = original;
    }
  });

  test("no env and no option → request carries no extra fields", async () => {
    const original = process.env.LITOPYS_EXTRACTOR_EXTRA_BODY;
    process.env.LITOPYS_EXTRACTOR_EXTRA_BODY = undefined;
    try {
      const calls: Array<Record<string, unknown>> = [];
      const adapter = new OpenAIAdapter({ client: capturingClient(calls) });
      await adapter.complete({ prompt: "hi" });
      expect(Object.keys(calls[0] ?? {}).sort()).toEqual(["max_tokens", "messages", "model"]);
    } finally {
      process.env.LITOPYS_EXTRACTOR_EXTRA_BODY = original;
    }
  });
});
