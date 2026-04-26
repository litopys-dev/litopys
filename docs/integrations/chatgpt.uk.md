# ChatGPT

> 🇬🇧 [Read in English](./chatgpt.md)

ChatGPT підтримує MCP лише через **Connectors** — платну/корпоративну функцію, яка недоступна у звичайному чаті. Інтеграція потребує розгортання Litopys як remote HTTP/SSE-сервера.

## Вимоги

- ChatGPT Pro / Team / Enterprise з увімкненими Connectors.
- Публічно доступний (або доступний через VPN) HTTP-ендпоінт для `litopys mcp http`.
- TLS-термінація (Connectors не приймають звичайний HTTP).

## Налаштування сервера

Запустіть MCP-сервер у режимі HTTP:

```bash
LITOPYS_MCP_TOKEN=your-long-random-token \
LITOPYS_MCP_BIND_ADDR=127.0.0.1 \
LITOPYS_MCP_CORS_ORIGIN=https://chat.openai.com \
  ~/.local/bin/litopys mcp http
```

Розмістіть nginx перед сервером:

```nginx
server {
  listen 443 ssl http2;
  server_name litopys.yourdomain.com;
  # TLS-конфігурація (certbot тощо)

  location / {
    proxy_pass http://127.0.0.1:7777;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;              # критично для SSE
    proxy_read_timeout 3600s;
  }
}
```

## Реєстрація в ChatGPT

Workspace Admin → **Connectors** → **Add custom connector**:

- **Name**: Litopys
- **Transport**: SSE
- **URL**: `https://litopys.yourdomain.com/sse`
- **Auth**: Bearer, token = значення `LITOPYS_MCP_TOKEN`

Збережіть, потім увімкніть Litopys у вашому workspace. ChatGPT відобразить п'ять інструментів.

## Застереження

- Підтримка MCP в ChatGPT є новішою, ніж у Claude; деякі схеми інструментів можуть відображатися некоректно.
- Звичайний ChatGPT (free/Plus) **не** підтримує MCP — лише плани з увімкненими Connectors.
- Тестуйте через вебінтерфейс ChatGPT, а не мобільний застосунок (мобільна підтримка відстає).

## Вирішення проблем

- **Connector показує "offline"** — перевірте `https://litopys.yourdomain.com/health` зі свого комп'ютера. Має повертати `{"status":"ok"}` без авторизації. Якщо не повертає — проблема в nginx/TLS, а не в Litopys.
- **401 при викликах інструментів** — токен у конфігурації Connector не збігається з `LITOPYS_MCP_TOKEN` на сервері. ChatGPT іноді обрізає пробіли в кінці при вставці.
