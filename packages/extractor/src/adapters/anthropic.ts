import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildUserPrompt } from "../prompt.ts";
import { parseExtractorOutput } from "./parse-output.ts";
import {
  AdapterCompleteError,
  type CompleteInput,
  type CompleteOutput,
  type ExtractorAdapter,
  type ExtractorInput,
  type ExtractorOutput,
} from "./types.ts";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export interface AnthropicClientLike {
  messages: {
    create: (params: unknown) => Promise<{
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export interface AnthropicAdapterOptions {
  apiKey?: string;
  model?: string;
  client?: AnthropicClientLike;
}

export class AnthropicAdapter implements ExtractorAdapter {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: AnthropicClientLike;

  constructor(opts: AnthropicAdapterOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    if (opts.client) {
      this.client = opts.client;
      return;
    }
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    this.client = new Anthropic({ apiKey }) as unknown as AnthropicClientLike;
  }

  async extract(input: ExtractorInput): Promise<ExtractorOutput> {
    const sessionId = `session-${Date.now()}`;
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input, sessionId);

    let rawText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;

      const first = response.content[0];
      if (first?.type === "text" && typeof first.text === "string") {
        rawText = first.text;
      }
    } catch (err) {
      process.stderr.write(`[litopys/extractor] Anthropic API error: ${String(err)}\n`);
      // Flagged as a failure, not as an empty extraction: the transcript was
      // never examined, so the caller must retry rather than move past it.
      return {
        candidateNodes: [],
        candidateRelations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        modelUsed: this.model,
        failure: { kind: "api", message: String(err) },
      };
    }

    return parseExtractorOutput({
      rawText,
      modelUsed: this.model,
      sessionId,
      inputTokens,
      outputTokens,
      providerLabel: "Anthropic",
    });
  }

  async complete(input: CompleteInput): Promise<CompleteOutput> {
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: input.maxTokens ?? 2048,
        messages: [{ role: "user", content: input.prompt }],
      });

      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;

      const first = response.content[0];
      if (first?.type === "text" && typeof first.text === "string") {
        text = first.text;
      }
    } catch (err) {
      process.stderr.write(`[litopys/extractor] Anthropic complete() error: ${String(err)}\n`);
      throw new AdapterCompleteError(`Anthropic complete() failed: ${String(err)}`, err);
    }

    return { text, usage: { inputTokens, outputTokens } };
  }
}
