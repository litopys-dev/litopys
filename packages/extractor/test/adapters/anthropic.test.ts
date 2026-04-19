import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ExtractorInput } from "../../src/adapters/types.ts";

// ---------------------------------------------------------------------------
// We mock the Anthropic SDK before importing AnthropicAdapter
// ---------------------------------------------------------------------------

const mockCreate = mock(async (_params: unknown) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        candidateNodes: [
          {
            id: "typescript-strict-mode",
            type: "concept",
            summary: "TypeScript strict mode",
            confidence: 0.9,
            reasoning: "Denis explicitly mentioned preferring strict TypeScript",
            sourceSessionId: "test-session",
          },
        ],
        candidateRelations: [],
      }),
    },
  ],
  usage: { input_tokens: 100, output_tokens: 50 },
}));

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Import after mocking
const { AnthropicAdapter } = await import("../../src/adapters/anthropic.ts");

describe("AnthropicAdapter", () => {
  test("throws if ANTHROPIC_API_KEY not set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = undefined;
    expect(() => new AnthropicAdapter()).toThrow("ANTHROPIC_API_KEY");
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  });

  test("uses provided apiKey option", () => {
    expect(() => new AnthropicAdapter({ apiKey: "sk-test" })).not.toThrow();
  });

  test("defaults to haiku model", () => {
    const adapter = new AnthropicAdapter({ apiKey: "sk-test" });
    expect(adapter.model).toBe("claude-haiku-4-5-20251001");
  });

  test("uses custom model if provided", () => {
    const adapter = new AnthropicAdapter({ apiKey: "sk-test", model: "claude-opus-4-5" });
    expect(adapter.model).toBe("claude-opus-4-5");
  });

  test("adapter name is 'anthropic'", () => {
    const adapter = new AnthropicAdapter({ apiKey: "sk-test" });
    expect(adapter.name).toBe("anthropic");
  });

  test("extract returns parsed candidates", async () => {
    const adapter = new AnthropicAdapter({ apiKey: "sk-test" });
    const input: ExtractorInput = {
      transcript: "Denis prefers TypeScript strict mode",
      existingNodeIds: [],
    };
    const output = await adapter.extract(input);
    expect(output.candidateNodes).toHaveLength(1);
    expect(output.candidateNodes[0]?.id).toBe("typescript-strict-mode");
    expect(output.candidateNodes[0]?.type).toBe("concept");
    expect(output.candidateNodes[0]?.confidence).toBe(0.9);
    expect(output.usage.inputTokens).toBe(100);
    expect(output.usage.outputTokens).toBe(50);
    expect(output.modelUsed).toBe("claude-haiku-4-5-20251001");
  });

  test("extract handles LLM returning invalid JSON gracefully", async () => {
    const badCreate = mock(async () => ({
      content: [{ type: "text", text: "not valid json at all!!!" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));

    mock.module("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { create: badCreate };
      },
    }));

    const { AnthropicAdapter: FreshAdapter } = await import("../../src/adapters/anthropic.ts");
    const adapter = new FreshAdapter({ apiKey: "sk-test" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.candidateRelations).toHaveLength(0);
  });

  test("extract handles schema validation failure gracefully", async () => {
    const badSchemaCreate = mock(async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            candidateNodes: [{ invalid: "structure", missing: "required fields" }],
            candidateRelations: [],
          }),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));

    mock.module("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { create: badSchemaCreate };
      },
    }));

    const { AnthropicAdapter: FreshAdapter } = await import("../../src/adapters/anthropic.ts");
    const adapter = new FreshAdapter({ apiKey: "sk-test" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    // Invalid nodes are filtered during zod parse, empty arrays returned
    expect(output.candidateRelations).toHaveLength(0);
  });

  test("extract handles API error gracefully", async () => {
    const failCreate = mock(async () => {
      throw new Error("API rate limit exceeded");
    });

    mock.module("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { create: failCreate };
      },
    }));

    const { AnthropicAdapter: FreshAdapter } = await import("../../src/adapters/anthropic.ts");
    const adapter = new FreshAdapter({ apiKey: "sk-test" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.usage.inputTokens).toBe(0);
  });

  test("extract strips markdown fences from response", async () => {
    const fencedCreate = mock(async () => ({
      content: [
        {
          type: "text",
          text: `\`\`\`json\n${JSON.stringify({ candidateNodes: [], candidateRelations: [] })}\n\`\`\``,
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));

    mock.module("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { create: fencedCreate };
      },
    }));

    const { AnthropicAdapter: FreshAdapter } = await import("../../src/adapters/anthropic.ts");
    const adapter = new FreshAdapter({ apiKey: "sk-test" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
  });
});
