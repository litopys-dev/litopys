# Claude Code

> 🇬🇧 [Read in English](./claude-code.md)

[Claude Code](https://docs.claude.com/en/docs/claude-code) — офіційний CLI від Anthropic. Спілкується через MCP по stdio.

## Реєстрація

```bash
claude mcp add litopys -- ~/.local/bin/litopys mcp stdio
```

Перезапустіть Claude Code (або виконайте `/mcp` і перепідключіться). П'ять інструментів Litopys — `litopys_search`, `litopys_get`, `litopys_related`, `litopys_create`, `litopys_link` — стають доступними автоматично, а ресурс `litopys://startup-context` автоматично завантажується на початку кожної нової сесії (профіль власника, активні проекти, останні події, ключові уроки).

## Перевірка

```bash
claude mcp list
# має показувати: litopys (connected)
```

У Claude Code запитайте щось на кшталт «що Litopys знає про мене?» — агент має викликати `litopys_search` і повернути результати.

## Відокремлені графи (опційно)

Направте Claude Code на окремий граф для конкретного проекту замість глобального, передавши змінну середовища:

```bash
claude mcp add litopys-work -- env LITOPYS_GRAPH_PATH=/path/to/work/graph \
  ~/.local/bin/litopys mcp stdio
```

## Session-start hook (опційно)

Ресурс `litopys://startup-context` надається автоматично, але деякі сценарії передбачають його ін'єкцію як звичайного промпта. Додайте `SessionStart` hook до `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": "~/.local/bin/litopys startup-context"
  }
}
```

Hook виводить markdown-знімок, який Claude Code додає на початок розмови.

## Вирішення проблем

- **"Could not spawn litopys"** — двійковий файл недоступний через PATH для процесу Claude Code. Використовуйте абсолютний шлях (`/home/you/.local/bin/litopys`) у команді `mcp add`.
- **"Tool not found: litopys_create with relation type supersedes"** — ваш MCP-сервер зібраний до версії 6.6. Виконайте `claude mcp remove litopys` → перевстановіть → `/mcp` перепідключіться.
