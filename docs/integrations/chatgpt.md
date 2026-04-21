# ChatGPT

ChatGPT supports MCP only through **Connectors** — a paid/enterprise feature, not the consumer chat app. Integration requires deploying Litopys as a remote HTTP/SSE server.

## Requirements

- ChatGPT Pro / Team / Enterprise with Connectors enabled.
- A publicly reachable (or VPN-reachable) HTTP endpoint for `litopys mcp http`.
- TLS termination (Connectors will not accept plain HTTP).

## Server setup

Start the MCP server in HTTP mode:

```bash
LITOPYS_MCP_TOKEN=your-long-random-token \
LITOPYS_MCP_BIND_ADDR=127.0.0.1 \
LITOPYS_MCP_CORS_ORIGIN=https://chat.openai.com \
  ~/.local/bin/litopys mcp http
```

Put nginx in front:

```nginx
server {
  listen 443 ssl http2;
  server_name litopys.yourdomain.com;
  # TLS config (certbot etc.)

  location / {
    proxy_pass http://127.0.0.1:7777;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;              # critical for SSE
    proxy_read_timeout 3600s;
  }
}
```

## Register in ChatGPT

Workspace Admin → **Connectors** → **Add custom connector**:

- **Name**: Litopys
- **Transport**: SSE
- **URL**: `https://litopys.yourdomain.com/sse`
- **Auth**: Bearer, token = the value of `LITOPYS_MCP_TOKEN`

Save, then enable Litopys in your workspace. ChatGPT will list the five tools.

## Caveats

- ChatGPT's MCP support is newer than Claude's; some tool schemas may render oddly.
- Consumer ChatGPT (free/Plus) does **not** expose MCP — only Connectors-enabled plans do.
- Test via the ChatGPT web UI, not the mobile app (mobile support lags).

## Troubleshooting

- **Connector shows "offline"** — hit `https://litopys.yourdomain.com/health` from your laptop. Should return `{"status":"ok"}` without auth. If it doesn't, the problem is nginx/TLS, not Litopys.
- **401 on tool calls** — the token in the Connector config doesn't match `LITOPYS_MCP_TOKEN` on the server. ChatGPT sometimes strips trailing whitespace on paste.
