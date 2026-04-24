import { afterEach, describe, expect, test } from "bun:test";
import { createAdapter } from "../../src/adapters/factory.ts";

// Adapter constructors instantiate SDK clients with a dummy API key — that's
// safe because no network calls happen until extract(). No module mocking.

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
