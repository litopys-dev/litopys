# Skill Detector — дизайн

**Дата:** 2026-06-10 · **Статус:** утверждён (Denis, Telegram msg 642) · **Ветка:** `feature/skill-detector`

## Цель

Процедурный слой памяти для Litopys: офлайн-анализ сессий Claude Code находит повторяющуюся рутину и задачи, решённые после серии ошибок, и генерирует черновики переиспользуемых скиллов (SKILL.md). Человек ревьюит черновик и устанавливает его в `~/.claude/skills/`. Аналог learning loop Hermes Agent (Nous Research), но в Dreams-стиле: офлайн-курация вместо in-session решений.

Декларативная память (узлы графа) у Litopys уже есть; этот компонент добавляет процедурную («как я это делаю»), чего нет ни в графе, ни в quarantine-пайплайне.

## Утверждённые решения

| Вопрос | Решение |
|---|---|
| Архитектура | Гибрид: SessionEnd помечает эпизоды, daemon кластеризует кросс-сессионно |
| Куда ставятся скиллы | `skillsDir` в конфиге, дефолт `~/.claude/skills/` |
| Ревью | quarantine-флоу (CLI + viewer) + секция в weekly digest + `notifyCommand`-алерт |
| LLM | Существующий `createAdapter()` — провайдер-агностик. У Denis сейчас Gemini 2.5 Flash через OpenAI-адаптер (`~/.litopys/.env`), НЕ Ollama |
| Кластеризация | LLM-группировка одним вызовом, БЕЗ эмбеддингов (YAGNI; shared-vector-api — возможное будущее улучшение) |
| Дашборд | Вкладка «Skill drafts» в viewer рядом с Quarantine |
| Исполнение | Рой Sonnet-субагентов, коммит после каждого подшага, Fable/Opus — только дизайн и ревью |

## Архитектура

```
Сессия Claude Code (JSONL)
   │
   ├─ SessionEnd hook (best-effort, в пределах 60s таймаута) ──┐
   │                                                            ▼
   └─ daemon catch-up (файлы, не менявшиеся >1ч) ──► Стадия A: extractEpisodes()
                                                         │  LLM: эпизоды из tool-aware транскрипта
                                                         ▼
                                              ~/.litopys/episodes/YYYY-MM.jsonl
                                                         │
                              Стадия B (daily, litopys-skills.timer): clusterAndDraft()
                                                         │  LLM: группировка эпизодов;
                                                         │  порог: паттерн в ≥2 сессиях
                                                         │  ИЛИ 1 эпизод «решение после серии ошибок»
                                                         ▼
                                       ~/.litopys/quarantine/skills/<name>/SKILL.md + meta.json
                                                         │
                        ┌────────────────────────────────┼──────────────────────┐
                        ▼                                ▼                      ▼
              CLI: litopys skills              viewer: вкладка          weekly digest:
              list|show|promote|reject         «Skill drafts»           секция Skill drafts
                        │                                │              + notifyCommand-алерт
                        └────────── promote ─────────────┘
                                       ▼
                          skillsDir (дефолт ~/.claude/skills/<name>/)
```

## Компоненты

### 1. Tool-aware парсинг транскриптов

Текущий парсинг (`sources/claude-code.ts`, `daemon/tick.ts#parseContent`) выбрасывает `tool_use`/`tool_result`. Для детекции «5+ tool-операций» и «решение после ошибок» нужен режим, сохраняющий:

- имена инструментов (`tool_use.name`) и однострочную выжимку input (например, команда Bash, путь файла);
- флаг ошибки из `tool_result` (`is_error` или эвристика «Exit code N / Error» в начале содержимого), без тел результатов.

Реализация: опция `includeTools: "summary"` в claude-code-парсере; общая функция, переиспользуемая хуком и daemon. Формат строки: `TOOL: Bash(git push) → ok` / `→ error`.

### 2. Стадия A — `packages/extractor/src/episodes.ts`

- `extractEpisodes(transcript, adapter): Episode[]` — один LLM-вызов, промпт просит выделить завершённые рабочие эпизоды.
- Схема Episode (JSONL, одна строка на эпизод):

```jsonc
{
  "id": "ep-<sha12>",            // hash(sessionId + goal)
  "sessionId": "...",
  "date": "2026-06-10",
  "goal": "перезапуск syut с проверкой логов",
  "steps": ["...", "..."],       // 3-10 обобщённых шагов
  "toolOps": 7,                   // число tool-операций в эпизоде
  "errorRecovery": true,          // решение найдено после ≥2 неудачных попыток
  "project": "syut",             // эвристика по cwd/упоминаниям, может быть null
  "tags": ["deploy", "systemd"],
  "clusteredInto": null           // id черновика скилла после Стадии B
}
```

- Хранение: append в `~/.litopys/episodes/YYYY-MM.jsonl`. Помесячные файлы — дёшево читать «непривязанные за последние 60 дней», старое архивируется само собой.
- Фильтр на входе: эпизод записывается только если `toolOps >= 5` ИЛИ `errorRecovery == true` (пороги в конфиге: `episodes.minToolOps`, дефолт 5).
- Вызов из `session-end.ts`: после существующей экстракции узлов, в том же 60s-бюджете; ошибка эпизодов не ломает основную экстракцию (try/catch, stub в `quarantine/failed/`).
- Вызов из daemon: догоняющий проход по session-файлам из тех же source-глобов, которые не менялись >1ч и ещё не обработаны (отметки в `daemon-state.json` → `episodesState: { [filePath]: { mtime, processed: true } }`). Дедуп по `id` эпизода.

### 3. Стадия B — `packages/extractor/src/skill-draft.ts`

- `clusterEpisodes(episodes, adapter)` — один LLM-вызов: на вход компактный список эпизодов (goal + steps + tags), на выход группы `{ name, episodeIds, worthSkill: bool, reason }`.
- Порог генерации: группа покрывает **≥2 разных sessionId**, ИЛИ единичный эпизод с `errorRecovery: true` и `toolOps >= minToolOps`.
- `draftSkill(group, episodes, adapter)` — второй LLM-вызов на группу: генерирует SKILL.md:

```markdown
---
name: <kebab-case>
description: <когда использовать, один абзац — триггер-условия>
---

# <Название>

## When to use
## Procedure
## Pitfalls
## Verification
```

  Формат совместим с Claude Code skills и agentskills.io (как у Hermes).
- Запись: `~/.litopys/quarantine/skills/<name>/SKILL.md` + `meta.json` (`{ name, createdAt, episodeIds, sessions, model, status: "pending" }`).
- Дедуп: перед записью сравнить `name` с существующими черновиками и со скиллами в `skillsDir`; при совпадении — пропустить и пометить эпизоды.
- После записи у задействованных эпизодов проставляется `clusteredInto` (перезапись строки JSONL допустима — файлы маленькие; реализация: прочитать файл, обновить, записать атомарно через tmp+rename).
- Запуск: `litopys skills tick` (CLI) + systemd `litopys-skills.service`/`.timer` (daily, по образцу litopys-digest). Идемпотентно: без новых непривязанных эпизодов — no-op без LLM-вызовов.
- `notifyCommand` (конфиг, дефолт пусто): shell-команда, получает текст алерта аргументом `$1`, вызывается при появлении нового черновика. У Denis — telegram-скрипт из мониторинга.

### 4. Skill-quarantine слой — `packages/extractor/src/skill-quarantine.ts`

Общий для CLI и viewer (по образцу `quarantine.ts`):

- `listSkillDrafts()` — все pending-черновики с meta.
- `readSkillDraft(name)` — SKILL.md + meta.
- `promoteSkillDraft(name, skillsDir)` — копирует папку черновика в `skillsDir/<name>/`, meta.json не копируется; статус → promoted (папка из quarantine удаляется, запись в `promoted.jsonl`).
- `rejectSkillDraft(name, reason)` — папка удаляется, запись в существующий `rejected.jsonl` (поле `kind: "skill"`).
- Защита: `promoteSkillDraft` отказывается перезаписывать существующий скилл в `skillsDir` без флага `--force`.

### 5. CLI — `litopys skills`

`list` · `show <name>` · `promote <name> [--force]` · `reject <name> [-r reason]` · `tick`. Конфиг: `skillsDir` (дефолт `~/.claude/skills`), `notifyCommand`, пороги.

### 6. Viewer — вкладка «Skill drafts»

- Рядом с существующей Quarantine (`app/pages/Quarantine.tsx`): новая страница `SkillDrafts.tsx`, пункт в Layout.
- Список черновиков → предпросмотр SKILL.md (рендер markdown) → кнопки Promote / Reject (с полем причины).
- API-эндпоинты в `server.ts` поверх skill-quarantine слоя. Локализация ru как у остального viewer.

### 7. Digest

`digest.ts`: секция «Skill drafts pending» — имя, описание, число эпизодов/сессий, команда для ревью.

## Обработка ошибок

- LLM-сбой в Стадии A из хука — не ломает экстракцию узлов; daemon догонит.
- LLM-сбой в Стадии B — tick завершается с ошибкой в journal, эпизоды остаются непривязанными, следующий tick повторит.
- Невалидный JSON от LLM — повтор одним ретраем, затем skip (как в существующих адаптерах).
- Кривой `name` от LLM — нормализация в kebab-case, коллизии решаются суффиксом `-2`.

## Тестирование

Mock-адаптер уже есть (`adapters/mock.ts`):

- unit: tool-aware парсинг (фикстура JSONL с tool_use/tool_result), episode store (append/чтение/обновление clusteredInto), пороги кластеризации, parse ответа LLM, promote/reject (включая --force и коллизии), нормализация name.
- e2e: фикстура транскрипта → mock-эпизоды → mock-кластер → черновик в tmp-quarantine → promote в tmp-skillsDir.
- viewer: API-тесты эндпоинтов (как у существующих quarantine-эндпоинтов).

## Вне объёма (намеренно)

- Эмбеддинг-кластеризация через shared-vector-api.
- Самоулучшение скиллов при использовании (Hermes skill self-improvement) — отдельная фича.
- Автоустановка без ревью человека.

## Порядок реализации — см. план

План с разбивкой на задачи для роя: `docs/superpowers/plans/2026-06-10-skill-detector-plan.md`. Дисциплина роя: Sonnet-исполнители, коммит после каждого подшага (lesson `swarm-commit-discipline`), TDD.
