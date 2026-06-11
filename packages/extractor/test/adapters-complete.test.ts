import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AnthropicAdapter, type AnthropicClientLike } from "../src/adapters/anthropic.ts";
import { MockAdapter } from "../src/adapters/mock.ts";
import { OllamaAdapter } from "../src/adapters/ollama.ts";
import { OpenAIAdapter, type OpenAIClientLike } from "../src/adapters/openai.ts";
import { AdapterCompleteError } from "../src/adapters/types.ts";

describe("adapter.complete", () => {
  test("mock returns queued completion and usage", async () => {
    const mock = new MockAdapter({ completions: ['{"groups":[]}'] });
    const out = await mock.complete({ prompt: "cluster these", maxTokens: 512 });
    expect(out.text).toBe('{"groups":[]}');
    expect(out.usage.inputTokens).toBeGreaterThanOrEqual(0);
  });

  test("mock repeats last completion when queue is exhausted", async () => {
    const mock = new MockAdapter({ completions: ["first", "last"] });
    const out1 = await mock.complete({ prompt: "p1" });
    const out2 = await mock.complete({ prompt: "p2" });
    const out3 = await mock.complete({ prompt: "p3" });
    expect(out1.text).toBe("first");
    expect(out2.text).toBe("last");
    expect(out3.text).toBe("last");
  });

  test("mock completeCalls counter increments", async () => {
    const mock = new MockAdapter({ completions: ["x"] });
    expect(mock.completeCalls).toBe(0);
    await mock.complete({ prompt: "a" });
    await mock.complete({ prompt: "b" });
    expect(mock.completeCalls).toBe(2);
  });

  test("mock uses outputTokens equal to text length", async () => {
    const text = '{"groups":[]}';
    const mock = new MockAdapter({ completions: [text] });
    const out = await mock.complete({ prompt: "p" });
    expect(out.usage.outputTokens).toBe(text.length);
  });
});

// ---------------------------------------------------------------------------
// OpenAI — constructor-level client injection, same as adapters/openai.test.ts
// ---------------------------------------------------------------------------

function fakeOpenAIClient(
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

describe("OpenAIAdapter.complete", () => {
  test("returns text and usage on success", async () => {
    const client = fakeOpenAIClient({
      choices: [{ message: { content: '{"groups":["a"]}' } }],
      usage: { prompt_tokens: 42, completion_tokens: 7 },
    });
    const adapter = new OpenAIAdapter({ client });
    const out = await adapter.complete({ prompt: "cluster these", maxTokens: 512 });
    expect(out.text).toBe('{"groups":["a"]}');
    expect(out.usage.inputTokens).toBe(42);
    expect(out.usage.outputTokens).toBe(7);
  });

  test("throws AdapterCompleteError on API error (e.g. 429)", async () => {
    const client = fakeOpenAIClient({ choices: [] }, new Error("429 Too Many Requests"));
    const adapter = new OpenAIAdapter({ client });
    await expect(adapter.complete({ prompt: "cluster these" })).rejects.toBeInstanceOf(
      AdapterCompleteError,
    );
  });
});

// ---------------------------------------------------------------------------
// Anthropic — constructor-level client injection, same as adapters/anthropic.test.ts
// ---------------------------------------------------------------------------

function fakeAnthropicClient(
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

describe("AnthropicAdapter.complete", () => {
  test("returns text and usage on success", async () => {
    const client = fakeAnthropicClient({
      content: [{ type: "text", text: '{"groups":["b"]}' }],
      usage: { input_tokens: 100, output_tokens: 25 },
    });
    const adapter = new AnthropicAdapter({ client });
    const out = await adapter.complete({ prompt: "cluster these", maxTokens: 512 });
    expect(out.text).toBe('{"groups":["b"]}');
    expect(out.usage.inputTokens).toBe(100);
    expect(out.usage.outputTokens).toBe(25);
  });

  test("throws AdapterCompleteError on API error (e.g. rate limit)", async () => {
    const client = fakeAnthropicClient(
      { content: [], usage: { input_tokens: 0, output_tokens: 0 } },
      new Error("API rate limit exceeded"),
    );
    const adapter = new AnthropicAdapter({ client });
    await expect(adapter.complete({ prompt: "cluster these" })).rejects.toBeInstanceOf(
      AdapterCompleteError,
    );
  });
});

// ---------------------------------------------------------------------------
// Ollama — global fetch mock, same as adapters/ollama.test.ts
// ---------------------------------------------------------------------------

describe("OllamaAdapter.complete", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("returns text on success (usage always zero — not provided by API)", async () => {
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ message: { content: '{"groups":["c"]}' } }),
    })) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const out = await adapter.complete({ prompt: "cluster these", maxTokens: 512 });
    expect(out.text).toBe('{"groups":["c"]}');
    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  test("throws AdapterCompleteError when fetch fails (ECONNREFUSED)", async () => {
    global.fetch = mock(async () => {
      throw new Error("fetch failed: ECONNREFUSED");
    }) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    await expect(adapter.complete({ prompt: "cluster these" })).rejects.toBeInstanceOf(
      AdapterCompleteError,
    );
  });
});
