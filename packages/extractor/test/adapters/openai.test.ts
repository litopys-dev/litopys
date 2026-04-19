import { describe, expect, mock, test } from "bun:test";
import type { ExtractorInput } from "../../src/adapters/types.ts";

// ---------------------------------------------------------------------------
// Mock the OpenAI SDK before importing OpenAIAdapter
// ---------------------------------------------------------------------------

const mockCompletionsCreate = mock(async (_params: unknown) => ({
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
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCompletionsCreate } };
  },
}));

const { OpenAIAdapter } = await import("../../src/adapters/openai.ts");

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

  test("extract returns parsed candidates and relations", async () => {
    const adapter = new OpenAIAdapter({ apiKey: "sk-test" });
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
    const badCreate = mock(async () => ({
      choices: [{ message: { content: "{ this is not json" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));

    mock.module("openai", () => ({
      default: class MockOpenAI {
        chat = { completions: { create: badCreate } };
      },
    }));

    const { OpenAIAdapter: FreshAdapter } = await import("../../src/adapters/openai.ts");
    const adapter = new FreshAdapter({ apiKey: "sk-test" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.candidateRelations).toHaveLength(0);
  });

  test("extract handles API error gracefully", async () => {
    const failCreate = mock(async () => {
      throw new Error("OpenAI API error: 429 Too Many Requests");
    });

    mock.module("openai", () => ({
      default: class MockOpenAI {
        chat = { completions: { create: failCreate } };
      },
    }));

    const { OpenAIAdapter: FreshAdapter } = await import("../../src/adapters/openai.ts");
    const adapter = new FreshAdapter({ apiKey: "sk-test" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.usage.inputTokens).toBe(0);
    expect(output.usage.outputTokens).toBe(0);
  });

  test("handles missing usage gracefully", async () => {
    const noUsageCreate = mock(async () => ({
      choices: [
        { message: { content: JSON.stringify({ candidateNodes: [], candidateRelations: [] }) } },
      ],
      usage: undefined,
    }));

    mock.module("openai", () => ({
      default: class MockOpenAI {
        chat = { completions: { create: noUsageCreate } };
      },
    }));

    const { OpenAIAdapter: FreshAdapter } = await import("../../src/adapters/openai.ts");
    const adapter = new FreshAdapter({ apiKey: "sk-test" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.usage.inputTokens).toBe(0);
    expect(output.usage.outputTokens).toBe(0);
  });
});
