# Gemini

> 🇬🇧 [Read in English](./gemini.md)

Нативна підтримка MCP у застосунках Google Gemini (Gemini web, Gemini app, AI Studio) **продовжує розвиватися** — на момент написання цього документа (квітень 2026) ситуація менш стабільна, ніж для Claude/Cursor/Cline. Доступні три шляхи:

## 1. Gemini CLI (`gemini-cli`)

Офіційний проект `gemini-cli` підтримує MCP-сервери через конфігураційний файл, аналогічний Claude Desktop:

```json
{
  "mcpServers": {
    "litopys": {
      "command": "/home/you/.local/bin/litopys",
      "args": ["mcp", "stdio"]
    }
  }
}
```

Розташування файлу залежить від версії — перевірте `gemini-cli --help` для отримання поточного шляху конфігурації. Перезапустіть CLI після редагування.

## 2. AI Studio / Vertex AI function calling

Якщо ви розробляєте агента на базі Gemini з Vertex AI SDK, можна підключити Litopys вручну: нехай ваш код агента викликає Litopys через MCP TypeScript SDK, а результати передає в API function calling від Gemini. Готового інтерфейсу «додати MCP-сервер» не існує.

Мінімальний міст включений до дорожньої карти (ще не реалізований).

## 3. Звичайний Gemini (web / Android / iOS)

Звичайний Gemini не підтримує MCP. Довелось би експортувати вузли Litopys як звичайний текст (наприклад, `litopys startup-context`) і вставляти їх вручну, що позбавляє сенсу.

## Рекомендація

Якщо ви використовуєте Claude Code / Desktop / Cursor / Cline — залишайтеся там: це найстабільніші MCP-хости на сьогодні. Поверніться до Gemini, коли його підтримка MCP стабілізується; цю сторінку буде оновлено тоді.
