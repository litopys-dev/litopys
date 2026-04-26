# Інтеграції

> 🇬🇧 [Read in English](./README.md)

Рецепти для конкретних клієнтів — підключення Litopys до MCP-сумісних хостів.

| Клієнт | Підтримка | Примітки |
|---|---|---|
| [Claude Code](./claude-code.uk.md) | ✅ Повна | Stdio transport, підтримує session-start hook |
| [Claude Desktop](./claude-desktop.uk.md) | ✅ Повна | Stdio або remote HTTP/SSE |
| [Cursor](./cursor.uk.md) | ✅ Повна | Settings JSON |
| [Cline](./cline.uk.md) | ✅ Повна | VS Code settings |
| [ChatGPT](./chatgpt.uk.md) | ⚠️ Обмежена | Лише workspace connectors |
| [Gemini](./gemini.uk.md) | ⚠️ Обмежена | Підтримка MCP ще розвивається |

Усі рецепти передбачають, що Litopys уже встановлено:

```bash
curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | sh
```

За замовчуванням двійковий файл знаходиться в `~/.local/bin/litopys`, граф — у `~/.litopys/graph`. Обидва шляхи можна змінити через `LITOPYS_INSTALL_DIR` / `LITOPYS_GRAPH_PATH`.

## Надавайте перевагу stdio

Для локальних інсталяцій завжди надавайте перевагу stdio transport (`litopys mcp stdio`):

- Не потребує керування токенами.
- Немає конфліктів портів.
- Клієнт самостійно перезапускає процес.

Використовуйте HTTP/SSE (`litopys mcp http`) лише коли:

- Клієнт запущено на іншій машині, ніж граф.
- Клієнт підтримує лише HTTP transport (наприклад, деякі remote connectors).
- Ви хочете використовувати один граф кількома клієнтами на одному хості (рідко — stdio для кожного клієнта простіше).
