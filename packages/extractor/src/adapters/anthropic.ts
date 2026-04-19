import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildUserPrompt } from "../prompt.ts";
import {
  type ExtractorAdapter,
  type ExtractorInput,
  type ExtractorOutput,
  LLMOutputSchema,
} from "./types.ts";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export interface AnthropicAdapterOptions {
  apiKey?: string;
  model?: string;
}

export class AnthropicAdapter implements ExtractorAdapter {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: AnthropicAdapterOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    this.model = opts.model ?? DEFAULT_MODEL;
    this.client = new Anthropic({ apiKey });
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
      if (first?.type === "text") {
        rawText = first.text;
      }
    } catch (err) {
      process.stderr.write(`[litopys/extractor] Anthropic API error: ${String(err)}\n`);
      return {
        candidateNodes: [],
        candidateRelations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        modelUsed: this.model,
      };
    }

    return parseOutput(rawText, this.model, inputTokens, outputTokens);
  }
}

function parseOutput(
  rawText: string,
  modelUsed: string,
  inputTokens: number,
  outputTokens: number,
): ExtractorOutput {
  // Strip potential markdown fences
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    process.stderr.write(
      `[litopys/extractor] Failed to parse LLM JSON response: ${rawText.slice(0, 200)}\n`,
    );
    return {
      candidateNodes: [],
      candidateRelations: [],
      usage: { inputTokens, outputTokens },
      modelUsed,
    };
  }

  const result = LLMOutputSchema.safeParse(parsed);
  if (!result.success) {
    process.stderr.write(
      `[litopys/extractor] LLM output failed schema validation: ${JSON.stringify(result.error.issues)}\n`,
    );
    return {
      candidateNodes: [],
      candidateRelations: [],
      usage: { inputTokens, outputTokens },
      modelUsed,
    };
  }

  return {
    candidateNodes: result.data.candidateNodes,
    candidateRelations: result.data.candidateRelations,
    usage: { inputTokens, outputTokens },
    modelUsed,
  };
}
