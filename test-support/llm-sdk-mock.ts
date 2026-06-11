/**
 * Shared preload mock for @anthropic-ai/sdk and openai.
 *
 * Registered ONCE via bunfig.toml [test] preload so that Bun's module cache
 * is seeded with a controlled stub before any test file executes.  Individual
 * test files must NOT call mock.module("@anthropic-ai/sdk") or
 * mock.module("openai") — they would silently lose the substitution once the
 * cache is warm.  Instead, they call setAnthropicCreate / setOpenAICreate in
 * beforeAll / afterAll to delegate per-test behaviour to this preload.
 */

import { mock } from "bun:test";

// ---------------------------------------------------------------------------
// Global delegation slots
// ---------------------------------------------------------------------------

declare global {
  var __litopysAnthropicCreate: ((req: unknown) => Promise<unknown>) | null | undefined;
  var __litopysOpenAICreate: ((req: unknown) => Promise<unknown>) | null | undefined;
}

// ---------------------------------------------------------------------------
// Default responses (empty candidates — safe fallback)
// ---------------------------------------------------------------------------

const DEFAULT_ANTHROPIC_RESPONSE = {
  content: [{ type: "text", text: '{"candidateNodes":[],"candidateRelations":[]}' }],
  usage: { input_tokens: 0, output_tokens: 0 },
};

const DEFAULT_OPENAI_RESPONSE = {
  choices: [{ message: { content: '{"candidateNodes":[],"candidateRelations":[]}' } }],
  usage: { prompt_tokens: 0, completion_tokens: 0 },
};

// ---------------------------------------------------------------------------
// Register module stubs — executed exactly once when the preload file runs
// ---------------------------------------------------------------------------

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async (req: unknown) => {
        const fn = globalThis.__litopysAnthropicCreate;
        if (fn) return fn(req);
        return DEFAULT_ANTHROPIC_RESPONSE;
      }),
    };
  },
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mock(async (req: unknown) => {
          const fn = globalThis.__litopysOpenAICreate;
          if (fn) return fn(req);
          return DEFAULT_OPENAI_RESPONSE;
        }),
      },
    };
  },
}));

// ---------------------------------------------------------------------------
// Exported helpers for test files
// ---------------------------------------------------------------------------

/**
 * Override the Anthropic messages.create handler for the current test file.
 * Pass null to reset to the safe default (empty candidateNodes).
 */
export function setAnthropicCreate(fn: ((req: unknown) => Promise<unknown>) | null): void {
  globalThis.__litopysAnthropicCreate = fn ?? undefined;
}

/**
 * Override the OpenAI chat.completions.create handler for the current test file.
 * Pass null to reset to the safe default (empty candidateNodes).
 */
export function setOpenAICreate(fn: ((req: unknown) => Promise<unknown>) | null): void {
  globalThis.__litopysOpenAICreate = fn ?? undefined;
}
