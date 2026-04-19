import OpenAI from "openai";
import { buildSystemPrompt, buildUserPrompt } from "../prompt.ts";
import {
  type ExtractorAdapter,
  type ExtractorInput,
  type ExtractorOutput,
  LLMOutputSchema,
} from "./types.ts";

const DEFAULT_MODEL = "gpt-4o-mini";

export interface OpenAIAdapterOptions {
  apiKey?: string;
  model?: string;
}

export class OpenAIAdapter implements ExtractorAdapter {
  readonly name = "openai";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(opts: OpenAIAdapterOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    this.model = opts.model ?? DEFAULT_MODEL;
    this.client = new OpenAI({ apiKey });
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
