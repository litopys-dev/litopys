import { AnthropicAdapter, type AnthropicAdapterOptions } from "./anthropic.ts";
import { MockAdapter, type MockAdapterOptions } from "./mock.ts";
import { OllamaAdapter, type OllamaAdapterOptions } from "./ollama.ts";
import { OpenAIAdapter, type OpenAIAdapterOptions } from "./openai.ts";
import type { ExtractorAdapter } from "./types.ts";

export type AdapterName = "anthropic" | "openai" | "ollama" | "mock";

export type AdapterOptions =
  | AnthropicAdapterOptions
  | OpenAIAdapterOptions
  | OllamaAdapterOptions
  | MockAdapterOptions;

/**
 * Create an adapter by name (or auto-detect from LITOPYS_EXTRACTOR_PROVIDER env).
 * Defaults to "anthropic".
 */
export function createAdapter(
  name?: AdapterName | string,
  opts?: AdapterOptions,
): ExtractorAdapter {
  const provider = name ?? process.env.LITOPYS_EXTRACTOR_PROVIDER ?? "anthropic";

  switch (provider) {
    case "anthropic":
      return new AnthropicAdapter(opts as AnthropicAdapterOptions);
    case "openai": {
      const openaiOpts = opts as OpenAIAdapterOptions | undefined;
      const baseURL = openaiOpts?.baseURL ?? process.env.LITOPYS_EXTRACTOR_BASE_URL;
      const apiKey =
        openaiOpts?.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.LITOPYS_EXTRACTOR_API_KEY;
      const model = openaiOpts?.model ?? process.env.LITOPYS_EXTRACTOR_MODEL;
      return new OpenAIAdapter({
        ...openaiOpts,
        ...(baseURL ? { baseURL } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(model ? { model } : {}),
      });
    }
    case "ollama":
      return new OllamaAdapter(opts as OllamaAdapterOptions);
    case "mock":
      return new MockAdapter(opts as MockAdapterOptions);
    default:
      throw new Error(
        `Unknown extractor provider: "${provider}". Valid values: "anthropic", "openai", "ollama", "mock".`,
      );
  }
}
