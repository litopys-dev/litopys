import { buildSystemPrompt, buildUserPrompt } from "../prompt.ts";
import {
  type ExtractorAdapter,
  type ExtractorInput,
  type ExtractorOutput,
  LLMOutputSchema,
} from "./types.ts";

const DEFAULT_MODEL = "llama3.2";
const DEFAULT_BASE_URL = "http://localhost:11434";

export interface OllamaAdapterOptions {
  baseUrl?: string;
  model?: string;
}

// Ollama uses plain HTTP fetch — no npm dependency required.
export class OllamaAdapter implements ExtractorAdapter {
  readonly name = "ollama";
  readonly model: string;
  private readonly baseUrl: string;

  constructor(opts: OllamaAdapterOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  async extract(input: ExtractorInput): Promise<ExtractorOutput> {
    const sessionId = `session-${Date.now()}`;
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input, sessionId);

    let rawText = "";

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          format: "json",
          stream: false,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(
          `Ollama responded with HTTP ${res.status}: ${await res.text().catch(() => "(no body)")}`,
        );
      }

      const json = (await res.json()) as { message?: { content?: string } };
      rawText = json.message?.content ?? "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
        process.stderr.write(
          `[litopys/extractor] Ollama is not available at ${this.baseUrl}. Ensure ollama is running and OLLAMA_BASE_URL is set correctly.\n`,
        );
      } else {
        process.stderr.write(`[litopys/extractor] Ollama error: ${message}\n`);
      }
      return {
        candidateNodes: [],
        candidateRelations: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        modelUsed: this.model,
      };
    }

    return parseOutput(rawText, this.model);
  }
}

function parseOutput(rawText: string, modelUsed: string): ExtractorOutput {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    process.stderr.write(
      `[litopys/extractor] Failed to parse Ollama JSON response: ${rawText.slice(0, 200)}\n`,
    );
    return {
      candidateNodes: [],
      candidateRelations: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      modelUsed,
    };
  }

  const result = LLMOutputSchema.safeParse(parsed);
  if (!result.success) {
    process.stderr.write(
      `[litopys/extractor] Ollama output failed schema validation: ${JSON.stringify(result.error.issues)}\n`,
    );
    return {
      candidateNodes: [],
      candidateRelations: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      modelUsed,
    };
  }

  return {
    candidateNodes: result.data.candidateNodes,
    candidateRelations: result.data.candidateRelations,
    usage: { inputTokens: 0, outputTokens: 0 },
    modelUsed,
  };
}
