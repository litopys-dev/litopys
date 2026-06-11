import { describe, expect, test } from "bun:test";
import { MockAdapter } from "../src/adapters/mock.ts";
import type { ExtractorAdapter } from "../src/adapters/types.ts";
import { makeEpisodeId } from "../src/episode-store.ts";
import { extractEpisodes } from "../src/episodes.ts";
import type { ParsedTranscript } from "../src/transcript-tools.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTranscript(text: string, toolOps = 0): ParsedTranscript {
  return { text, toolOps, errorCount: 0 };
}

const SESSION_ID = "sess-test-001";
const SESSION_DATE = "2026-06-10";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("extractEpisodes", () => {
  test("happy path — returns 1 Episode with correct id/sessionId/date", async () => {
    const mockResponse = JSON.stringify({
      episodes: [
        {
          goal: "перезапуск syut",
          steps: ["проверить статус сервиса", "перезапустить юнит", "проверить логи"],
          toolOps: 7,
          errorRecovery: true,
          project: "syut",
          tags: ["deploy"],
        },
      ],
    });

    const adapter = new MockAdapter({ completions: [mockResponse] });
    const transcript = makeTranscript("TOOL: Bash(systemctl status) → ok\nASSISTANT: restarting");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toHaveLength(1);
    const ep = episodes[0];
    expect(ep?.goal).toBe("перезапуск syut");
    expect(ep?.sessionId).toBe(SESSION_ID);
    expect(ep?.date).toBe(SESSION_DATE);
    expect(ep?.id).toBe(makeEpisodeId(SESSION_ID, "перезапуск syut"));
    expect(ep?.clusteredInto).toBeNull();
    expect(ep?.project).toBe("syut");
    expect(ep?.tags).toEqual(["deploy"]);
    expect(ep?.errorRecovery).toBe(true);
    expect(ep?.toolOps).toBe(7);
  });

  test("episode with toolOps:2, errorRecovery:false is filtered out", async () => {
    const mockResponse = JSON.stringify({
      episodes: [
        {
          goal: "небольшая задача",
          steps: ["шаг один", "шаг два", "шаг три"],
          toolOps: 2,
          errorRecovery: false,
          project: null,
          tags: ["misc"],
        },
      ],
    });

    const adapter = new MockAdapter({ completions: [mockResponse] });
    const transcript = makeTranscript("ASSISTANT: did a small thing");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toHaveLength(0);
  });

  test("episode with toolOps:2, errorRecovery:true passes post-filter", async () => {
    const mockResponse = JSON.stringify({
      episodes: [
        {
          goal: "восстановление после ошибки",
          steps: ["обнаружить ошибку", "исправить конфиг", "перезапустить"],
          toolOps: 2,
          errorRecovery: true,
          project: null,
          tags: ["fix"],
        },
      ],
    });

    const adapter = new MockAdapter({ completions: [mockResponse] });
    const transcript = makeTranscript("TOOL: Bash(…) → error\nTOOL: Bash(…) → ok");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.errorRecovery).toBe(true);
  });

  test("broken JSON → one retry → completeCalls === 2 → empty array returned", async () => {
    const adapter = new MockAdapter({ completions: ["not json", '{"episodes":[]}'] });
    const transcript = makeTranscript("ASSISTANT: some work done");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toEqual([]);
    expect(adapter.completeCalls).toBe(2);
  });

  test("valid JSON with wrong shape → one retry → good response parsed, completeCalls === 2", async () => {
    const goodResponse = JSON.stringify({
      episodes: [
        {
          goal: "восстановленный эпизод",
          steps: ["шаг один", "шаг два", "шаг три"],
          toolOps: 5,
          errorRecovery: false,
          project: null,
          tags: ["retry"],
        },
      ],
    });
    const adapter = new MockAdapter({ completions: ['{"foo":1}', goodResponse] });
    const transcript = makeTranscript("ASSISTANT: some work done");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.goal).toBe("восстановленный эпизод");
    expect(adapter.completeCalls).toBe(2);
  });

  test("two episodes with the same goal → deduped by id, higher-toolOps one survives", async () => {
    const goal = "повторяющаяся цель";
    const mockResponse = JSON.stringify({
      episodes: [
        {
          goal,
          steps: ["шаг один", "шаг два", "шаг три"],
          toolOps: 4,
          errorRecovery: false,
          project: null,
          tags: ["first"],
        },
        {
          goal,
          steps: ["другой шаг", "ещё шаг", "финальный шаг"],
          toolOps: 9,
          errorRecovery: false,
          project: "dup-project",
          tags: ["second"],
        },
      ],
    });
    const adapter = new MockAdapter({ completions: [mockResponse] });
    const transcript = makeTranscript("ASSISTANT: duplicated work");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.id).toBe(makeEpisodeId(SESSION_ID, goal));
    expect(episodes[0]?.toolOps).toBe(9);
    expect(episodes[0]?.tags).toEqual(["second"]);
  });

  test("broken JSON on both attempts → empty array, no exception", async () => {
    const adapter = new MockAdapter({ completions: ["not json at all"] });
    const transcript = makeTranscript("ASSISTANT: some work done");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toEqual([]);
    expect(adapter.completeCalls).toBe(2);
  });

  test("response in ```json code fences → fences stripped, parses correctly", async () => {
    const innerJson = JSON.stringify({
      episodes: [
        {
          goal: "тестовый эпизод",
          steps: ["шаг один", "шаг два", "шаг три"],
          toolOps: 5,
          errorRecovery: false,
          project: "test-project",
          tags: ["test"],
        },
      ],
    });
    const fencedResponse = `\`\`\`json\n${innerJson}\n\`\`\``;

    const adapter = new MockAdapter({ completions: [fencedResponse] });
    const transcript = makeTranscript("ASSISTANT: did some testing");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.goal).toBe("тестовый эпизод");
  });

  test("response in plain ``` fences (no language tag) → fences stripped", async () => {
    const innerJson = JSON.stringify({
      episodes: [
        {
          goal: "ещё один эпизод",
          steps: ["шаг один", "шаг два", "шаг три"],
          toolOps: 4,
          errorRecovery: false,
          project: null,
          tags: ["other"],
        },
      ],
    });
    const fencedResponse = `\`\`\`\n${innerJson}\n\`\`\``;

    const adapter = new MockAdapter({ completions: [fencedResponse] });
    const transcript = makeTranscript("ASSISTANT: more work");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.goal).toBe("ещё один эпизод");
  });

  test("episode with invalid fields (goal length 500) → skipped, valid episodes survive", async () => {
    const longGoal = "а".repeat(500); // exceeds EpisodeSchema max(200)
    const mockResponse = JSON.stringify({
      episodes: [
        {
          goal: longGoal,
          steps: ["шаг один", "шаг два", "шаг три"],
          toolOps: 5,
          errorRecovery: false,
          project: null,
          tags: ["bad"],
        },
        {
          goal: "валидный эпизод",
          steps: ["шаг один", "шаг два", "шаг три"],
          toolOps: 6,
          errorRecovery: false,
          project: "my-project",
          tags: ["good"],
        },
      ],
    });

    const adapter = new MockAdapter({ completions: [mockResponse] });
    const transcript = makeTranscript("ASSISTANT: mixed validity");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.goal).toBe("валидный эпизод");
  });

  test("empty transcript.text → returns [] immediately without LLM call", async () => {
    const adapter = new MockAdapter({ completions: ['{"episodes":[]}'] });
    const transcript = makeTranscript("");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toEqual([]);
    expect(adapter.completeCalls).toBe(0);
  });

  test("transcript with only whitespace → returns [] without LLM call", async () => {
    const adapter = new MockAdapter({ completions: ['{"episodes":[]}'] });
    const transcript = makeTranscript("   \n\t  ");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toEqual([]);
    expect(adapter.completeCalls).toBe(0);
  });

  test("multiple valid episodes — all returned and filtered correctly", async () => {
    const mockResponse = JSON.stringify({
      episodes: [
        {
          goal: "деплой приложения",
          steps: ["собрать образ", "отправить в реестр", "обновить k8s"],
          toolOps: 8,
          errorRecovery: false,
          project: "myapp",
          tags: ["deploy", "k8s"],
        },
        {
          goal: "исправление бага",
          steps: ["локализовать баг", "написать тест", "исправить код"],
          toolOps: 1,
          errorRecovery: false,
          project: "myapp",
          tags: ["bugfix"],
        },
        {
          goal: "настройка мониторинга",
          steps: ["установить агент", "настроить алерты", "проверить дашборд"],
          toolOps: 5,
          errorRecovery: true,
          project: "infra",
          tags: ["monitoring"],
        },
      ],
    });

    const adapter = new MockAdapter({ completions: [mockResponse] });
    const transcript = makeTranscript("ASSISTANT: lots of work today");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    // toolOps:1, errorRecovery:false → filtered out
    expect(episodes).toHaveLength(2);
    expect(episodes.map((e) => e.goal)).toEqual(["деплой приложения", "настройка мониторинга"]);
  });

  test("episode id is stable/deterministic across calls", async () => {
    const goal = "стабильный эпизод";
    const mockResponse = JSON.stringify({
      episodes: [
        {
          goal,
          steps: ["шаг один", "шаг два", "шаг три"],
          toolOps: 4,
          errorRecovery: false,
          project: null,
          tags: [],
        },
      ],
    });

    const transcript = makeTranscript("ASSISTANT: stable work");

    const adapter1 = new MockAdapter({ completions: [mockResponse] });
    const episodes1 = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter1, {
      minToolOps: 3,
    });

    const adapter2 = new MockAdapter({ completions: [mockResponse] });
    const episodes2 = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter2, {
      minToolOps: 3,
    });

    expect(episodes1[0]?.id).toBe(episodes2[0]?.id);
    expect(episodes1[0]?.id).toBe(makeEpisodeId(SESSION_ID, goal));
  });

  test("transcript with $& / $' is substituted literally (no replacement-pattern expansion)", async () => {
    const mockResponse = JSON.stringify({
      episodes: [
        {
          goal: "поиск по логам",
          steps: ["выполнить grep", "проверить вывод", "сохранить результат"],
          toolOps: 5,
          errorRecovery: false,
          project: null,
          tags: ["grep"],
        },
      ],
    });

    // Spy adapter: capture every prompt passed to complete()
    const inner = new MockAdapter({ completions: [mockResponse] });
    const capturedPrompts: string[] = [];
    const adapter: ExtractorAdapter = {
      name: inner.name,
      model: inner.model,
      extract: (input) => inner.extract(input),
      complete: (input) => {
        capturedPrompts.push(input.prompt);
        return inner.complete(input);
      },
    };

    const transcript = makeTranscript("TOOL: Bash(grep $& and $') → ok");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toHaveLength(1);
    expect(capturedPrompts).toHaveLength(1);
    const prompt = capturedPrompts[0];
    // Literal transcript text present, $-patterns NOT expanded
    expect(prompt).toContain("TOOL: Bash(grep $& and $') → ok");
    // The placeholder must be fully consumed — $& expansion would re-inject it
    expect(prompt).not.toContain("{transcript}");
  });

  test("API error (empty text from adapter) → triggers retry → returns []", async () => {
    // Simulates adapter returning "" (error path) on both calls
    const adapter = new MockAdapter({ completions: [""] });
    const transcript = makeTranscript("ASSISTANT: doing work");

    const episodes = await extractEpisodes(transcript, SESSION_ID, SESSION_DATE, adapter, {
      minToolOps: 3,
    });

    expect(episodes).toEqual([]);
    expect(adapter.completeCalls).toBe(2);
  });
});
