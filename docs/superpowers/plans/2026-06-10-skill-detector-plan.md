# Skill Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Процедурный слой памяти Litopys — детекция повторяющейся рутины в сессиях Claude Code и генерация черновиков SKILL.md с ревью через CLI/viewer.

**Architecture:** Стадия A: эпизоды извлекаются из tool-aware транскриптов (SessionEnd-хук + daemon-догонка) в `~/.litopys/episodes/YYYY-MM.jsonl`. Стадия B (daily timer): LLM-кластеризация эпизодов → черновики в `~/.litopys/quarantine/skills/<name>/`. Ревью: `litopys skills` CLI и вкладка viewer; promote копирует в `skillsDir` (дефолт `~/.claude/skills/`).

**Tech Stack:** Bun + TypeScript, zod, существующая фабрика LLM-адаптеров (`createAdapter()`, у Denis — Gemini 2.5 Flash через openai-адаптер), `bun test`.

**Спека:** `docs/superpowers/specs/2026-06-10-skill-detector-design.md` — читать ПЕРЕД началом.

**Ветка:** `feature/skill-detector`. Коммит после каждой задачи (НЕ реже). TDD: тест → fail → код → pass → commit.

**Прогресс:** отмечать чекбоксы в ЭТОМ файле и коммитить его вместе с кодом — это якорь для восстановления контекста.

---

## Карта файлов

| Файл | Ответственность | Задача |
|---|---|---|
| `packages/extractor/src/adapters/types.ts` | +`complete()` в интерфейсе | 1 |
| `packages/extractor/src/adapters/{openai,ollama,anthropic,mock}.ts` | реализация `complete()` | 1 |
| `packages/extractor/src/transcript-tools.ts` (create) | tool-aware парсинг JSONL | 2 |
| `packages/extractor/src/episode-store.ts` (create) | схема Episode, append/чтение/markClustered | 3 |
| `packages/extractor/src/episodes.ts` (create) | extractEpisodes() — LLM Стадии A | 4 |
| `packages/extractor/src/session-end.ts` | вызов extractEpisodes после экстракции узлов | 5 |
| `packages/daemon/src/tick.ts`, `state.ts` | episodesState, догонка | 6 |
| `packages/extractor/src/skill-config.ts` (create) | skillsDir, notifyCommand, пороги | 7 |
| `packages/extractor/src/skill-draft.ts` (create) | clusterEpisodes() + draftSkill() — Стадия B | 8 |
| `packages/extractor/src/skill-quarantine.ts` (create) | list/read/promote/reject черновиков | 9 |
| `packages/cli/src/index.ts` | команда `skills` | 10 |
| `packages/extractor/systemd/litopys-skills.{service,timer}` (create) | daily запуск | 10 |
| `packages/viewer/src/server.ts`, `app/api.ts`, `app/pages/SkillDrafts.tsx` (create), `app/components/Layout.tsx` | вкладка Skill drafts | 11 |
| `packages/extractor/src/digest.ts` | секция Skill drafts pending | 12 |
| `packages/extractor/test/skill-detector-e2e.test.ts` (create) | сквозной тест на mock | 13 |

Тесты кладём рядом с существующими: `packages/extractor/test/*.test.ts`, `packages/daemon/test/*.test.ts`, `packages/viewer/test/*.test.ts` (проверь фактическое расположение существующих тестов пакета и положи рядом; если тестов в пакете нет — создай `test/`).

---

### Task 1: `complete()` у LLM-адаптеров

Существующий `ExtractorAdapter.extract()` возвращает только candidate-узлы. Эпизодам и кластеризации нужен freeform-JSON ответ → добавляем generic-метод.

**Files:** Modify: `packages/extractor/src/adapters/types.ts`, `openai.ts`, `ollama.ts`, `anthropic.ts`, `mock.ts`. Test: `packages/extractor/test/adapters-complete.test.ts`

- [x] **1.1 Тест (mock):**

```ts
import { describe, expect, test } from "bun:test";
import { MockAdapter } from "../src/adapters/mock.ts";

describe("adapter.complete", () => {
  test("mock returns queued completion and usage", async () => {
    const mock = new MockAdapter({ completions: ['{"groups":[]}'] });
    const out = await mock.complete({ prompt: "cluster these", maxTokens: 512 });
    expect(out.text).toBe('{"groups":[]}');
    expect(out.usage.inputTokens).toBeGreaterThanOrEqual(0);
  });
});
```

- [x] **1.2 Запустить — FAIL** (`bun test packages/extractor/test/adapters-complete.test.ts`; нет метода/опции).
- [x] **1.3 Интерфейс в `types.ts`:**

```ts
export interface CompleteInput {
  prompt: string;
  maxTokens?: number; // default 2048
}
export interface CompleteOutput {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}
// в ExtractorAdapter:
  complete(input: CompleteInput): Promise<CompleteOutput>;
```

Реализации: openai — `chat.completions.create` с тем же клиентом/моделью, system prompt не нужен; ollama/anthropic — аналогично их существующим вызовам в `extract()` (переиспользуй приватные методы запроса, не дублируй HTTP-код); mock — опция `completions: string[]`, отдаёт по очереди, последняя повторяется.

- [x] **1.4 Тесты пакета зелёные:** `bun test packages/extractor` (все существующие тоже).
- [x] **1.5 Commit:** `feat(extractor): add complete() to LLM adapters`

---

### Task 2: Tool-aware парсинг транскриптов

Сейчас `daemon/tick.ts#parseContent` и `sources/claude-code.ts` выбрасывают tool_use/tool_result. Нужен общий модуль с режимом, сохраняющим имена тулзов и флаги ошибок.

**Files:** Create: `packages/extractor/src/transcript-tools.ts`. Modify: `packages/extractor/src/index.ts` (экспорт). Test: `packages/extractor/test/transcript-tools.test.ts`

- [x] **2.1 Тест с фикстурой:**

```ts
import { describe, expect, test } from "bun:test";
import { parseClaudeCodeTranscript } from "../src/transcript-tools.ts";

const lines = [
  JSON.stringify({ type: "user", sessionId: "s1", message: { role: "user", content: "перезапусти syut" } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
    { type: "text", text: "Рестартую." },
    { type: "tool_use", id: "t1", name: "Bash", input: { command: "systemctl restart syut" } },
  ]}}),
  JSON.stringify({ type: "user", message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "t1", is_error: true, content: "Exit code 1: unit not found" },
  ]}}),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
    { type: "tool_use", id: "t2", name: "Bash", input: { command: "systemctl --user restart syut" } },
  ]}}),
  JSON.stringify({ type: "user", message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "t2", content: "ok" },
  ]}}),
].join("\n");

describe("parseClaudeCodeTranscript", () => {
  test("tools mode keeps tool names, input gist and error flags", () => {
    const r = parseClaudeCodeTranscript(lines, { includeTools: "summary" });
    expect(r.text).toContain("USER: перезапусти syut");
    expect(r.text).toContain("TOOL: Bash(systemctl restart syut) → error");
    expect(r.text).toContain("TOOL: Bash(systemctl --user restart syut) → ok");
    expect(r.toolOps).toBe(2);
    expect(r.errorCount).toBe(1);
  });
  test("default mode drops tools (back-compat)", () => {
    const r = parseClaudeCodeTranscript(lines, {});
    expect(r.text).not.toContain("TOOL:");
  });
});
```

- [x] **2.2 FAIL** → **2.3 Реализация.** Сигнатура:

```ts
export interface ParsedTranscript { text: string; toolOps: number; errorCount: number; sessionId?: string; }
export function parseClaudeCodeTranscript(
  raw: string,
  opts: { includeTools?: "summary" },
): ParsedTranscript;
```

Правила: input-gist — `input.command` для Bash, `input.file_path` для Read/Edit/Write, иначе первые 60 симв. JSON.stringify(input); gist обрезать до 80 симв. Ошибка tool_result: `is_error === true` ИЛИ содержимое начинается с `Exit code [1-9]` / `Error`. Тела tool_result НЕ включать. Сопоставление result→use по `tool_use_id` (для определения имени тулза не обязательно — достаточно последнего pending tool_use; но если просто, сопоставляй по id через Map). Неполные/битые строки пропускать (как `parseJsonlContent` в `daemon/tick.ts:307`).

- [x] **2.4 PASS**, `bun test packages/extractor` зелёный. **2.5 Commit:** `feat(extractor): tool-aware claude-code transcript parsing`

---

### Task 3: Episode store

**Files:** Create: `packages/extractor/src/episode-store.ts`. Modify: `packages/extractor/src/index.ts`. Test: `packages/extractor/test/episode-store.test.ts`

- [x] **3.1 Типы и схема (zod, в episode-store.ts):**

```ts
export const EpisodeSchema = z.object({
  id: z.string(),                 // "ep-" + sha256(sessionId+goal).slice(0,12)
  sessionId: z.string(),
  date: z.string(),               // YYYY-MM-DD
  goal: z.string().max(200),
  steps: z.array(z.string()).min(1).max(10),
  toolOps: z.number().int().min(0),
  errorRecovery: z.boolean(),
  project: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  clusteredInto: z.string().nullable().default(null),
});
export type Episode = z.infer<typeof EpisodeSchema>;
```

API (все принимают `episodesDir: string` — НЕ зашивать `~/.litopys`, дефолт отдаёт `defaultEpisodesDir()` = `path.join(defaultGraphPath(), "..", "episodes")`):

```ts
appendEpisodes(episodes: Episode[], episodesDir): Promise<number>  // дедуп по id против уже записанных; файл YYYY-MM.jsonl по дате эпизода
listUnclustered(episodesDir, sinceDays = 60): Promise<Episode[]>
markClustered(ids: string[], draftName: string, episodesDir): Promise<void> // атомарно: tmp + rename
```

- [x] **3.2 Тест:** append двух эпизодов → файл `2026-06.jsonl` существует, повторный append тех же id возвращает 0; `listUnclustered` отдаёт оба; `markClustered([id1], "restart-syut")` → listUnclustered отдаёт один, в файле у первого `clusteredInto: "restart-syut"`. Использовать `fs.mkdtemp(os.tmpdir())`.
- [x] **3.3 FAIL → реализация → PASS.** **3.4 Commit:** `feat(extractor): episode store (jsonl, monthly files)`

---

### Task 4: Стадия A — extractEpisodes()

**Files:** Create: `packages/extractor/src/episodes.ts`. Modify: `index.ts`. Test: `packages/extractor/test/episodes.test.ts`

- [x] **4.1 Промпт (константа в episodes.ts, на английском, ответ — строго JSON):**

```
You analyze a work-session transcript of a coding agent. Identify completed work EPISODES — coherent units of work with a clear goal (e.g. "restart service X and verify logs", "fix failing test Y").
For each episode output: goal (short, in Russian), steps (3-10 generalized imperative steps, Russian), toolOps (count of TOOL: lines belonging to the episode), errorRecovery (true if the solution was found after 2+ failed attempts — look for "→ error" followed by retries), project (best guess from paths/names, else null), tags (2-5 lowercase english).
Skip: trivial Q&A, episodes with toolOps < {minToolOps} unless errorRecovery is true, unfinished work.
Respond with JSON only: {"episodes":[{...}]}
TRANSCRIPT:
{transcript}
```

- [x] **4.2 Тест на mock-адаптере:** mock возвращает `{"episodes":[{goal,steps,toolOps:7,errorRecovery:true,project:"syut",tags:["deploy"]}]}` → `extractEpisodes(parsed, "sess-1", adapter, {minToolOps:5})` отдаёт 1 Episode c проставленными id/sessionId/date; второй тест — эпизод `toolOps:2, errorRecovery:false` отфильтрован; третий — битый JSON от LLM → один ретрай (mock: `completions: ["not json", '{"episodes":[]}']`) → пустой массив без исключения.
- [x] **4.3 FAIL → реализация.** Сигнатура: `extractEpisodes(transcript: ParsedTranscript, sessionId: string, adapter: ExtractorAdapter, opts: { minToolOps: number }): Promise<Episode[]>`. Парс ответа: вырезать ```json-фенсы при наличии, JSON.parse, zod safeParse поэлементно (битый эпизод — пропустить, не валить всё). **4.4 PASS → Commit:** `feat(extractor): stage A episode extraction`

---

### Task 5: Интеграция в SessionEnd-хук

**Files:** Modify: `packages/extractor/src/session-end.ts` (после `writeQuarantine` в `doExtract`, строки ~123-128). Test: `packages/extractor/test/session-end-episodes.test.ts` (если в пакете есть тест хука — рядом; иначе тестируй выделенную функцию).

- [x] **5.1** Выделить в session-end.ts экспортируемую функцию `runEpisodeStage(transcriptRaw: string, sessionId: string, adapter: ExtractorAdapter): Promise<number>` — парсит через `parseClaudeCodeTranscript(raw, {includeTools:"summary"})`, зовёт `extractEpisodes`, пишет через `appendEpisodes`, возвращает число записанных. Вызвать её из `doExtract` в try/catch: ошибка пишется в stderr, НЕ роняет хук и не мешает уже записанному карантину.
- [x] **5.2 Тест:** mock-адаптер + tmp episodesDir (прокинуть параметром с дефолтом) → после `runEpisodeStage` файл с эпизодом существует; при mock, кидающем исключение, функция возвращает 0 и не бросает.
- [x] **5.3 Commit:** `feat(extractor): episode stage in SessionEnd hook (best-effort)`

---

### Task 6: Daemon-догонка эпизодов

**Files:** Modify: `packages/daemon/src/state.ts` (поле `episodesState?: Record<string, { mtime: string }>`), `packages/daemon/src/tick.ts`. Test: `packages/daemon/test/episodes-catchup.test.ts`

- [x] **6.1** Новая функция в tick.ts: `runEpisodesCatchup(opts: { sources: SourceConfig[]; adapter: ExtractorAdapter; episodesDir: string; minAgeMs?: number /* default 3_600_000 */ }, state: DaemonState): Promise<{ filesProcessed: number; episodesFound: number }>`. Логика: expandSources (переиспользовать) → файлы claude-code, у которых `mtime < now - minAgeMs` и (`episodesState[path]` отсутствует или `mtime` изменился) → читать файл ЦЕЛИКОМ → `parseClaudeCodeTranscript(..., {includeTools:"summary"})` → если `toolOps >= minToolOps` или `errorCount >= 2` — `extractEpisodes` + `appendEpisodes` (дедуп по id защищает от пересечения с хуком) → обновить `episodesState[path] = { mtime }`. Файлы с малым числом тулзов тоже помечать обработанными (чтобы не перечитывать).
- [x] **6.2 Тест:** tmp-дир с фикстурой JSONL (из Task 2) + mock → первый вызов processed=1, второй (без изменений файла) processed=0; свежий файл (mtime = сейчас) — не трогается.
- [x] **6.3** Вызвать `runEpisodesCatchup` из `cmdDaemon tick` (cli) после `runTick`, с адаптером из той же фабрики; ошибки — в stderr, не валят tick. **Commit:** `feat(daemon): episodes catch-up pass in daemon tick`

---

### Task 7: Конфиг skill-detector

**Files:** Create: `packages/extractor/src/skill-config.ts`. Test: `packages/extractor/test/skill-config.test.ts`

- [x] **7.1**

```ts
export interface SkillDetectorConfig {
  skillsDir: string;        // env LITOPYS_SKILLS_DIR, default ~/.claude/skills
  notifyCommand: string | null; // env LITOPYS_SKILLS_NOTIFY_CMD, default null
  minToolOps: number;       // env LITOPYS_SKILLS_MIN_TOOL_OPS, default 5
  minSessions: number;      // env LITOPYS_SKILLS_MIN_SESSIONS, default 2
}
export function loadSkillConfig(env = process.env): SkillDetectorConfig;
```

Тест: дефолты без env; переопределение через env; кривое число в env → дефолт + stderr-warning (паттерн как в `daemon/config.ts`).
- [x] **7.2 Commit:** `feat(extractor): skill-detector config via env`

---

### Task 8: Стадия B — clusterEpisodes() + draftSkill()

**Files:** Create: `packages/extractor/src/skill-draft.ts`. Modify: `index.ts`. Test: `packages/extractor/test/skill-draft.test.ts`

- [x] **8.1 Промпт кластеризации (JSON-ответ):**

```
You are given work episodes from different agent sessions. Group episodes that describe the SAME recurring procedure (same goal pattern, similar steps). 
Respond JSON only: {"groups":[{"name":"<kebab-case-en>","episodeIds":[...],"worthSkill":true|false,"reason":"<1 sentence>"}]}
A group is worthSkill if the procedure is non-trivial and likely to recur. Single-episode groups are allowed.
EPISODES:
{json array: id, goal, steps, tags, sessionId, errorRecovery, toolOps}
```

- [x] **8.2 Промпт генерации SKILL.md:** на вход name + эпизоды группы; на выход — готовый markdown с frontmatter `name`, `description` (description = триггер-условия, один абзац) и секциями `## When to use`, `## Procedure` (нумерованные шаги, обобщённые из эпизодов, с конкретными командами где были), `## Pitfalls` (из errorRecovery-эпизодов: что не сработало), `## Verification`. Язык тела — русский, name/description — английский kebab/прозa.
- [x] **8.3 Функции:**

```ts
export interface EpisodeGroup { name: string; episodeIds: string[]; worthSkill: boolean; reason: string; }
clusterEpisodes(episodes: Episode[], adapter): Promise<EpisodeGroup[]>      // фенсы/ретрай как в Task 4
selectDraftable(groups, episodes, cfg): EpisodeGroup[]                       // ≥ cfg.minSessions РАЗНЫХ sessionId, ИЛИ один эпизод errorRecovery && toolOps >= cfg.minToolOps
draftSkill(group, episodes, adapter): Promise<string>                        // SKILL.md текст; нормализация name: lower, [^a-z0-9-]→-, схлоп --, коллизия → суффикс -2
writeSkillDraft(name, skillMd, meta, quarantineSkillsDir): Promise<string>   // <dir>/<name>/SKILL.md + meta.json {name, createdAt, episodeIds, sessions, model, status:"pending"}
```

- [x] **8.4 Тесты (mock):** группа из эпизодов 2 разных сессий → draftable; группа из 2 эпизодов одной сессии → нет; одиночный errorRecovery → draftable; нормализация имени `"Restart SYUT!"` → `restart-syut`; writeSkillDraft создаёт оба файла, повторный вызов с тем же name — бросает `Error("draft already exists: <name>")` (тест через `expect(...).rejects.toThrow()`).
- [x] **8.5 FAIL → реализация → PASS → Commit:** `feat(extractor): stage B clustering and SKILL.md drafting`

---

### Task 9: Skill-quarantine слой

**Files:** Create: `packages/extractor/src/skill-quarantine.ts`. Modify: `index.ts`. Test: `packages/extractor/test/skill-quarantine.test.ts`

- [x] **9.1 API (все пути параметрами, дефолты от `defaultGraphPath()`):**

```ts
export interface SkillDraftMeta { name: string; createdAt: string; episodeIds: string[]; sessions: string[]; model: string; status: "pending"; }
listSkillDrafts(qsDir): Promise<Array<{ meta: SkillDraftMeta; description: string }>>  // description — из frontmatter SKILL.md
readSkillDraft(name, qsDir): Promise<{ meta: SkillDraftMeta; skillMd: string }>
promoteSkillDraft(name, qsDir, skillsDir, opts?: { force?: boolean }): Promise<string> // копирует папку БЕЗ meta.json; existing target && !force → throw; успех: запись в <qsDir>/../promoted.jsonl, удаление черновика; возвращает путь установки
rejectSkillDraft(name, qsDir, graphPath, reason?): Promise<void>                       // запись в существующий quarantine/rejected.jsonl c kind:"skill", удаление папки
```

- [x] **9.2 Тесты:** полный цикл в tmp-дирах — write (из Task 8) → list видит 1 → promote → файл в skillsDir/<name>/SKILL.md есть, meta.json НЕТ, черновик удалён, promoted.jsonl содержит строку; promote при существующем скилле без force → throw, с force → ок; reject пишет в rejected.jsonl с `kind:"skill"` и reason.
- [x] **9.3 Commit:** `feat(extractor): skill draft quarantine (list/promote/reject)`

---

### Task 10: CLI `litopys skills` + tick-оркестрация + systemd

**Files:** Modify: `packages/cli/src/index.ts` (по образцу блока `quarantine` в `main()`, см. строки ~265-280), `usage()`. Create: `packages/extractor/src/skills-tick.ts`, `packages/extractor/systemd/litopys-skills.service`, `litopys-skills.timer`. Test: `packages/extractor/test/skills-tick.test.ts`

- [x] **10.1 Оркестрация `skills-tick.ts`:**

```ts
export async function runSkillsTick(opts: { episodesDir; quarantineSkillsDir; cfg: SkillDetectorConfig; adapter: ExtractorAdapter }): Promise<{ drafts: string[] }>
```

listUnclustered → пусто? → `{drafts:[]}` БЕЗ LLM-вызовов → иначе cluster → selectDraftable → дедуп против существующих черновиков и skillsDir (по name) → draft+write → markClustered(episodeIds, name) → если `cfg.notifyCommand` задан, на каждый новый черновик вызвать `Bun.spawn(["sh", "-c", `${cfg.notifyCommand} "$1"`, "_", message])`, где message: `Litopys: новый черновик скилла "<name>" (<N> эпизодов, <M> сессий). Ревью: litopys skills show <name>`. Ошибка notify — stderr, не валит tick.
- [x] **10.2 Тест:** mock на полный цикл (2 эпизода 2 сессий) → 1 черновик, эпизоды помечены; повторный запуск → 0 черновиков и 0 вызовов complete (проверить счётчиком вызовов в mock).
- [x] **10.3 CLI:** `skills list|show <name>|promote <name> [--force]|reject <name> [reason]|tick`. Вывод в стиле существующих cmd (см. `cmdQuarantineList`). Обновить `usage()`.
- [x] **10.4 systemd** (по образцу `packages/extractor/systemd/litopys-digest.*`): service — `ExecStart=… index.ts skills tick`, `EnvironmentFile=-%h/.litopys/.env`; timer — `OnCalendar=*-*-* 08:30:00`, `Persistent=true`. НЕ устанавливать юниты на сервере в рамках задачи — только файлы в репо (установка — руками Denis, Tier 2/3).
- [x] **10.5 Commit:** `feat(cli,extractor): litopys skills command + daily tick units`

---

### Task 11: Viewer — вкладка «Skill drafts»

**Files:** Modify: `packages/viewer/src/server.ts` (роуты рядом с `/api/quarantine`, строки ~677-690: GET `/api/skills` без auth; POST `/api/skills/promote`, `/api/skills/reject` через `authGate`), `packages/viewer/src/app/api.ts` (методы по образцу `quarantine`/`accept`/`reject`, строки ~262-270), `packages/viewer/src/app/components/Layout.tsx` (пункт меню), `packages/viewer/src/app/i18n.ts` (ru-строки). Create: `packages/viewer/src/app/pages/SkillDrafts.tsx`. Test: `packages/viewer/test/skills-api.test.ts`

- [x] **11.1 API-тест:** поднять `createServer({port:0})` c tmp-окружением (как существующие тесты viewer, посмотри их паттерн) → GET `/api/skills` отдаёт `[]`; после `writeSkillDraft` в tmp — отдаёт 1 запись с `meta.name` и `description`; POST promote/reject меняют состояние.
- [x] **11.2 Страница:** список черновиков (имя, описание, N эпизодов/сессий, дата) → клик: предпросмотр SKILL.md тем же markdown-рендером, что у узлов (найди компонент рендера в существующих страницах и переиспользуй) → кнопки «Установить» (promote; confirm при перезаписи → force) и «Отклонить» (prompt причины). Стиль и i18n — как у `Quarantine.tsx`.
- [x] **11.3 Commit:** `feat(viewer): skill drafts review tab`

---

### Task 12: Секция в digest

**Files:** Modify: `packages/extractor/src/digest.ts` (`generateManualDigest`, после секции Pending Quarantine). Test: дополнить `packages/extractor/test/` существующий digest-тест или новый `digest-skills.test.ts`

- [x] **12.1** В `generateDigest` добавить `listSkillDrafts()` в `Promise.all`; в манифест — секция `## Skill Drafts Pending`: имя, description, episodes/sessions count, `litopys skills show <name>`; при пустом списке секция с «No skill drafts pending.». Тест: digest в tmp-окружении с 1 черновиком содержит имя черновика.
- [x] **12.2 Commit:** `feat(extractor): skill drafts section in weekly digest`

---

### Task 13: E2E + финальная верификация

**Files:** Create: `packages/extractor/test/skill-detector-e2e.test.ts`

- [x] **13.1 E2E на mock:** фикстура-транскрипт (две «сессии» с одинаковой рутиной) → `runEpisodeStage` ×2 → `runSkillsTick` → черновик существует, SKILL.md содержит frontmatter и 4 секции → `promoteSkillDraft` → скилл в tmp-skillsDir. Все пути — tmp.
- [x] **13.2** Полный прогон: `bun test` из корня — ВСЁ зелёное (включая не тронутые пакеты).
- [x] **13.3** `bun run` lint/typecheck если есть в scripts (проверь `package.json`; biome/tsc — выполнить).
- [x] **13.4 Commit:** `test(extractor): skill-detector e2e`
- [x] **13.5** Отметить все чекбоксы здесь, финальный коммит плана. НЕ мержить в main и НЕ пушить без команды Denis.

---

## Восстановление контекста (если сессия оборвалась)

1. `git -C ~/litopys log --oneline feature/skill-detector ^main` — что уже сделано.
2. Этот файл: первый неотмеченный чекбокс — текущая задача.
3. Спека: `docs/superpowers/specs/2026-06-10-skill-detector-design.md`.
4. Решения и контекст — в Litopys graph: узлы `hermes-agent-learning-loop`, `litopys-extractor-provider-gemini`, проект `litopys`.
5. Дисциплина: рой Sonnet-субагентов, коммит после каждой задачи, TDD, Fable/Opus — только ревью.
