import { describe, expect, test } from "bun:test";
import { AnthropicAdapter, type AnthropicClientLike } from "../../src/adapters/anthropic.ts";
import type { ExtractorInput } from "../../src/adapters/types.ts";

// ---------------------------------------------------------------------------
// Tests use constructor-level dependency injection (client option) so they
// don't touch the module registry — safe to mix with other adapter tests
// that would otherwise collide through mock.module("@anthropic-ai/sdk").
// ---------------------------------------------------------------------------

function fakeClient(
  response: {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  },
  throwError?: Error,
): AnthropicClientLike {
  return {
    messages: {
      create: async () => {
        if (throwError) throw throwError;
        return response;
      },
    },
  };
}

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

  test("accepts injected client without apiKey", () => {
    const client = fakeClient({
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(() => new AnthropicAdapter({ client })).not.toThrow();
  });

  test("extract returns parsed candidates", async () => {
    const client = fakeClient({
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
                reasoning: "Alice explicitly mentioned preferring strict TypeScript",
                sourceSessionId: "test-session",
              },
            ],
            candidateRelations: [],
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const adapter = new AnthropicAdapter({ client });
    const input: ExtractorInput = {
      transcript: "Alice prefers TypeScript strict mode",
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
    const client = fakeClient({
      content: [{ type: "text", text: "not valid json at all!!!" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const adapter = new AnthropicAdapter({ client });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.candidateRelations).toHaveLength(0);
  });

  test("extract handles schema validation failure gracefully", async () => {
    const client = fakeClient({
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
    });
    const adapter = new AnthropicAdapter({ client });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateRelations).toHaveLength(0);
  });

  test("extract handles API error gracefully", async () => {
    const client = fakeClient(
      { content: [], usage: { input_tokens: 0, output_tokens: 0 } },
      new Error("API rate limit exceeded"),
    );
    const adapter = new AnthropicAdapter({ client });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.usage.inputTokens).toBe(0);
  });

  test("extract strips markdown fences from response", async () => {
    const client = fakeClient({
      content: [
        {
          type: "text",
          text: `\`\`\`json\n${JSON.stringify({ candidateNodes: [], candidateRelations: [] })}\n\`\`\``,
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const adapter = new AnthropicAdapter({ client });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
  });
});
