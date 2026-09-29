import OpenAI from "openai";
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

const DEFAULT_MODEL = "gpt-4o-mini";

export interface OpenAIClientLike {
  chat: {
    completions: {
      create: (params: unknown) => Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>;
    };
  };
}

export interface OpenAIAdapterOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  client?: OpenAIClientLike;
  /**
   * Provider-specific fields merged into every chat.completions request,
   * e.g. `{ chat_template_kwargs: { enable_thinking: false } }` to turn off
   * reasoning on NIM / vLLM hybrid models. Defaults to the JSON in
   * LITOPYS_EXTRACTOR_EXTRA_BODY.
   */
  extraBody?: Record<string, unknown>;
}

function parseExtraBody(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`LITOPYS_EXTRACTOR_EXTRA_BODY is not valid JSON: ${String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("LITOPYS_EXTRACTOR_EXTRA_BODY must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export class OpenAIAdapter implements ExtractorAdapter {
  readonly name = "openai";
  readonly model: string;
  private readonly client: OpenAIClientLike;
  private readonly extraBody: Record<string, unknown>;

  constructor(opts: OpenAIAdapterOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.extraBody = opts.extraBody ?? parseExtraBody(process.env.LITOPYS_EXTRACTOR_EXTRA_BODY);
    if (opts.client) {
      this.client = opts.client;
      return;
    }
    const baseURL = opts.baseURL ?? process.env.LITOPYS_EXTRACTOR_BASE_URL;
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? (baseURL ? "none" : undefined);
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    }) as unknown as OpenAIClientLike;
  }

  async extract(input: ExtractorInput): Promise<ExtractorOutput> {
    const sessionId = `session-${Date.now()}`;
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input, sessionId);

    let rawText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const response = await this.client.chat.completions.create({
        ...this.extraBody,
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
      });

      inputTokens = response.usage?.prompt_tokens ?? 0;
      outputTokens = response.usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      if (choice?.message?.content) {
        rawText = choice.message.content;
      }
    } catch (err) {
      process.stderr.write(`[litopys/extractor] OpenAI API error: ${String(err)}\n`);
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
      providerLabel: "OpenAI",
    });
  }

  async complete(input: CompleteInput): Promise<CompleteOutput> {
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const response = await this.client.chat.completions.create({
        ...this.extraBody,
        model: this.model,
        messages: [{ role: "user", content: input.prompt }],
        max_tokens: input.maxTokens ?? 2048,
      });

      inputTokens = response.usage?.prompt_tokens ?? 0;
      outputTokens = response.usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      if (choice?.message?.content) {
        text = choice.message.content;
      }
    } catch (err) {
      process.stderr.write(`[litopys/extractor] OpenAI complete() error: ${String(err)}\n`);
      throw new AdapterCompleteError(`OpenAI complete() failed: ${String(err)}`, err);
    }

    return { text, usage: { inputTokens, outputTokens } };
  }
}
