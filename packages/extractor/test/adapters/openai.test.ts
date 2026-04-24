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

  test("extract handles API error gracefully", async () => {
    const client = fakeClient(
      { choices: [] },
      new Error("OpenAI API error: 429 Too Many Requests"),
    );
    const adapter = new OpenAIAdapter({ client });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.usage.inputTokens).toBe(0);
    expect(output.usage.outputTokens).toBe(0);
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
