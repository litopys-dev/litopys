# Cursor

> 🇬🇧 [Read in English](./cursor.md)

[Cursor](https://cursor.com) підтримує MCP через settings JSON. Конфігурація аналогічна Claude Desktop.

## Реєстрація

Відкрийте налаштування Cursor (`⌘,` / `Ctrl+,`), знайдіть "MCP" і додайте:

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

Або відредагуйте `~/.cursor/mcp.json` безпосередньо.

Перезапустіть Cursor. П'ять інструментів Litopys стають доступними в будь-якій MCP-підтримуваній розмові (Agent mode, Composer).

## Перевірка

У чаті Agent mode запитайте: *«Які вузли типу `project` є в моєму Litopys?»* — агент Cursor має викликати `litopys_search` з параметром `types: ["project"]`.

## Графи для окремих робочих просторів

Прив'яжіть граф до конкретного репозиторію, розмістивши `.cursor/mcp.json` у каталозі робочого простору:

```json
{
  "mcpServers": {
    "litopys-this-repo": {
      "command": "/Users/you/.local/bin/litopys",
      "args": ["mcp", "stdio"],
      "env": {
        "LITOPYS_GRAPH_PATH": "${workspaceFolder}/.litopys/graph"
      }
    }
  }
}
```

## Вирішення проблем

- **Вкладка MCP показує "Error" навпроти litopys** — клацніть на рядку, щоб побачити stderr. Найпоширеніша причина: неправильний абсолютний шлях до двійкового файлу.
- **Інструменти не з'являються в чаті** — Cursor відображає MCP-інструменти лише в Agent mode, а не у звичайному чаті.
