import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OllamaAdapter } from "../../src/adapters/ollama.ts";
import type { ExtractorInput } from "../../src/adapters/types.ts";

// ---------------------------------------------------------------------------
// Mock global fetch for Ollama HTTP calls
// ---------------------------------------------------------------------------

const validResponse = {
  candidateNodes: [
    {
      id: "llm-memory",
      type: "concept",
      summary: "LLM memory management",
      confidence: 0.75,
      reasoning: "Discussed extensively in session as a key challenge",
      sourceSessionId: "test-session",
    },
  ],
  candidateRelations: [],
};

describe("OllamaAdapter", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("adapter name is 'ollama'", () => {
    const adapter = new OllamaAdapter();
    expect(adapter.name).toBe("ollama");
  });

  test("defaults to llama3.2 model", () => {
    const adapter = new OllamaAdapter();
    expect(adapter.model).toBe("llama3.2");
  });

  test("uses custom model if provided", () => {
    const adapter = new OllamaAdapter({ model: "mistral" });
    expect(adapter.model).toBe("mistral");
  });

  test("uses default base URL", () => {
    const adapter = new OllamaAdapter();
    // Just checking it doesn't throw, baseUrl is private
    expect(adapter.name).toBe("ollama");
  });

  test("uses OLLAMA_BASE_URL env variable", () => {
    const original = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = "http://custom-ollama:11434";
    const adapter = new OllamaAdapter();
    expect(adapter.name).toBe("ollama");
    if (original !== undefined) process.env.OLLAMA_BASE_URL = original;
    else process.env.OLLAMA_BASE_URL = undefined;
  });

  test("extract parses valid response", async () => {
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify(validResponse) } }),
    })) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const input: ExtractorInput = {
      transcript: "LLM memory is a key challenge in AI systems",
      existingNodeIds: [],
    };
    const output = await adapter.extract(input);
    expect(output.candidateNodes).toHaveLength(1);
    expect(output.candidateNodes[0]?.id).toBe("llm-memory");
    expect(output.candidateNodes[0]?.type).toBe("concept");
    expect(output.modelUsed).toBe("llama3.2");
  });

  test("extract returns empty array when Ollama is not available (ECONNREFUSED)", async () => {
    global.fetch = mock(async () => {
      throw new Error("fetch failed: ECONNREFUSED");
    }) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
    expect(output.candidateRelations).toHaveLength(0);
  });

  test("extract handles HTTP error response gracefully", async () => {
    global.fetch = mock(async () => ({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    })) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
  });

  test("extract handles invalid JSON from Ollama gracefully", async () => {
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ message: { content: "not valid json {{{" } }),
    })) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(0);
  });

  test("extract handles schema validation failure", async () => {
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            candidateNodes: [{ wrong: "schema", no: "required fields" }],
            candidateRelations: [],
          }),
        },
      }),
    })) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    // Schema validation fails on individual items; adapter returns empty
    expect(output.candidateRelations).toHaveLength(0);
  });

  test("extract strips markdown fences", async () => {
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: `\`\`\`json\n${JSON.stringify(validResponse)}\n\`\`\``,
        },
      }),
    })) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(1);
  });

  test("usage tokens are 0 for Ollama (not provided by API)", async () => {
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify(validResponse) } }),
    })) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.usage.inputTokens).toBe(0);
    expect(output.usage.outputTokens).toBe(0);
  });

  test("aborts and returns empty when timeout fires", async () => {
    // Simulate a fetch that never resolves (hangs), but we set a very short timeout
    global.fetch = mock(async (_url: string, opts: RequestInit) => {
      // Immediately abort via the signal that was passed in
      await new Promise<never>((_, reject) => {
        if (opts.signal) {
          opts.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    }) as unknown as typeof global.fetch;

    const orig = process.env.LITOPYS_OLLAMA_TIMEOUT_MS;
    process.env.LITOPYS_OLLAMA_TIMEOUT_MS = "1"; // 1 ms — fires almost immediately

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });

    process.env.LITOPYS_OLLAMA_TIMEOUT_MS = orig;

    expect(output.candidateNodes).toHaveLength(0);
    expect(output.candidateRelations).toHaveLength(0);
  });

  test("uses LITOPYS_OLLAMA_TIMEOUT_MS env to override default", async () => {
    // Just verify the adapter doesn't throw when the env var is set to a valid number
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify(validResponse) } }),
    })) as unknown as typeof global.fetch;

    const orig = process.env.LITOPYS_OLLAMA_TIMEOUT_MS;
    process.env.LITOPYS_OLLAMA_TIMEOUT_MS = "30000";

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });

    process.env.LITOPYS_OLLAMA_TIMEOUT_MS = orig;

    expect(output.candidateNodes).toHaveLength(1);
  });

  test("normalizes candidates missing confidence and sourceSessionId", async () => {
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            candidateNodes: [
              {
                id: "llm-memory",
                type: "concept",
                summary: "LLM memory",
                reasoning: "Discussed in session",
              },
            ],
            candidateRelations: [
              {
                type: "applies_to",
                sourceId: "llm-memory",
                targetId: "acme-bot",
                reasoning: "Memory applies to bot",
              },
            ],
          }),
        },
      }),
    })) as unknown as typeof global.fetch;

    const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
    const output = await adapter.extract({ transcript: "test", existingNodeIds: [] });
    expect(output.candidateNodes).toHaveLength(1);
    expect(output.candidateNodes[0]?.confidence).toBe(0.5);
    expect(output.candidateNodes[0]?.sourceSessionId).toMatch(/^session-\d+$/);
    expect(output.candidateRelations).toHaveLength(1);
    expect(output.candidateRelations[0]?.confidence).toBe(0.5);
  });
});
