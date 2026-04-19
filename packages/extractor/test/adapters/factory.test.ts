import { afterEach, describe, expect, test } from "bun:test";

// Mock both SDKs before import
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => ({
        content: [
          { type: "text", text: JSON.stringify({ candidateNodes: [], candidateRelations: [] }) },
        ],
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    };
  },
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: async () => ({
          choices: [
            {
              message: { content: JSON.stringify({ candidateNodes: [], candidateRelations: [] }) },
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        }),
      },
    };
  },
}));

import { mock } from "bun:test";
const { createAdapter } = await import("../../src/adapters/factory.ts");

describe("createAdapter", () => {
  let originalProvider: string | undefined;

  afterEach(() => {
    if (originalProvider !== undefined) {
      process.env.LITOPYS_EXTRACTOR_PROVIDER = originalProvider;
    } else {
      process.env.LITOPYS_EXTRACTOR_PROVIDER = undefined;
    }
  });

  test("creates anthropic adapter by default", () => {
    process.env.LITOPYS_EXTRACTOR_PROVIDER = undefined;
    const adapter = createAdapter(undefined, { apiKey: "sk-test" });
    expect(adapter.name).toBe("anthropic");
  });

  test("creates anthropic adapter explicitly", () => {
    const adapter = createAdapter("anthropic", { apiKey: "sk-test" });
    expect(adapter.name).toBe("anthropic");
  });

  test("creates openai adapter", () => {
    const adapter = createAdapter("openai", { apiKey: "sk-openai-test" });
    expect(adapter.name).toBe("openai");
  });

  test("creates ollama adapter", () => {
    const adapter = createAdapter("ollama");
    expect(adapter.name).toBe("ollama");
  });

  test("reads provider from LITOPYS_EXTRACTOR_PROVIDER env", () => {
    originalProvider = process.env.LITOPYS_EXTRACTOR_PROVIDER;
    process.env.LITOPYS_EXTRACTOR_PROVIDER = "ollama";
    const adapter = createAdapter(undefined);
    expect(adapter.name).toBe("ollama");
  });

  test("throws on unknown provider name", () => {
    expect(() => createAdapter("unknown-llm" as "anthropic")).toThrow("Unknown extractor provider");
  });
});
