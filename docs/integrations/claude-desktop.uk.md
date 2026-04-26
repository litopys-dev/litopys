# Claude Desktop

> 🇬🇧 [Read in English](./claude-desktop.md)

[Claude Desktop](https://claude.ai/download) спілкується через MCP по stdio за допомогою конфігураційного файлу.

## Реєстрація (stdio)

Відредагуйте `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Додайте запис `litopys` у розділ `mcpServers`:

```json
{
  "mcpServers": {
    "litopys": {
      "command": "/Users/you/.local/bin/litopys",
      "args": ["mcp", "stdio"],
      "env": {
        "LITOPYS_GRAPH_PATH": "/Users/you/.litopys/graph"
      }
    }
  }
}
```

Використовуйте абсолютний шлях до двійкового файлу — Claude Desktop не успадковує PATH вашої оболонки. Повністю завершіть роботу Claude Desktop через меню (не просто закривайте вікно) і перезапустіть його.

## Перевірка

Відкрийте нову розмову. Значок штекера поруч із полем введення тексту має показувати, що `litopys` підключено. Запитайте: *«знайди в моєму Litopys-графі вузли зі словом "python"»* — Claude має викликати `litopys_search`.

## Режим Remote (HTTP/SSE)

Використовуйте HTTP, коли граф знаходиться на іншій машині (наприклад, домашньому сервері):

```json
{
  "mcpServers": {
    "litopys-remote": {
      "transport": "sse",
      "url": "https://litopys.yourdomain.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR-TOKEN"
      }
    }
  }
}
```

На сервері:

```bash
LITOPYS_MCP_TOKEN=YOUR-TOKEN LITOPYS_MCP_BIND_ADDR=127.0.0.1 \
  ~/.local/bin/litopys mcp http
# потім налаштуйте reverse-proxy через nginx + TLS
```

Повний фрагмент конфігурації nginx дивіться в [документації інтеграції ChatGPT](./chatgpt.uk.md#налаштування-сервера) — серверна частина налаштовується ідентично.

## Вирішення проблем

- **Зміни конфігурації не застосовуються** — Claude Desktop кешує конфігурацію. Примусово завершіть роботу через меню, потім перезапустіть.
- **"Failed to spawn"** — перевірте шлях до двійкового файлу командою `which litopys` у вашій оболонці та вставте абсолютний результат у конфігурацію.
