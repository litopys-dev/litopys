# Cline

> 🇬🇧 [Read in English](./cline.md)

[Cline](https://cline.bot) (раніше Claude Dev) — розширення для VS Code. Має власний MCP marketplace і ручно налаштовувану конфігурацію.

## Реєстрація

Відкрийте панель команд VS Code → *«Cline: MCP Servers»*. Натисніть *«Configure MCP Servers»* — відкриється `cline_mcp_settings.json`. Додайте:

```json
{
  "mcpServers": {
    "litopys": {
      "command": "/home/you/.local/bin/litopys",
      "args": ["mcp", "stdio"],
      "env": {
        "LITOPYS_GRAPH_PATH": "/home/you/.litopys/graph"
      },
      "disabled": false,
      "autoApprove": ["litopys_search", "litopys_get", "litopys_related"]
    }
  }
}
```

`autoApprove` є опційним — дозволяє Cline викликати інструменти лише для читання без підтвердження кожного разу. Залиште записи (`litopys_create`, `litopys_link`) на ручне підтвердження, якщо бажаєте.

Перезавантажте вікно або увімкніть/вимкніть сервер у панелі MCP у Cline.

## Перевірка

Запустіть завдання у Cline. Запитайте: *«Знайди в моєму Litopys-графі все про TypeScript.»* — Cline має викликати `litopys_search` і показати JSON-відповідь.

## Вирішення проблем

- **Сервер залишається в стані "connecting…"** — перевірте канал виводу Cline (`Ctrl+`` → Output → Cline`) на наявність помилок запуску.
- **Записи відхиляються** — Cline запитує підтвердження для кожного виклику інструменту. Видаліть інструмент із `autoApprove`, щоб увімкнути інтерактивне підтвердження, або додайте до списку завжди дозволених.
