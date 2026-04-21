import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpServer } from "../src/http.ts";

const TOKEN = "test-token-abc";

let server: Server;
let closeFn: () => Promise<void>;
let baseUrl = "";

beforeAll(async () => {
  const handle = createHttpServer({ token: TOKEN });
  server = handle.server;
  closeFn = handle.close;
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await closeFn();
});

describe("HTTP server — health", () => {
  test("GET /health returns 200 without auth", async () => {
    const r = await fetch(`${baseUrl}/health`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});

describe("HTTP server — auth", () => {
  test("GET /sse without Authorization → 401", async () => {
    const r = await fetch(`${baseUrl}/sse`);
    expect(r.status).toBe(401);
  });

  test("GET /sse with wrong token → 401", async () => {
    const r = await fetch(`${baseUrl}/sse`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(r.status).toBe(401);
  });

  test("POST /messages without auth → 401", async () => {
    const r = await fetch(`${baseUrl}/messages?sessionId=x`, {
      method: "POST",
      body: "{}",
    });
    expect(r.status).toBe(401);
  });

  test("unknown route without auth → 401 (auth gate runs before route match)", async () => {
    const r = await fetch(`${baseUrl}/definitely-not-a-route`);
    expect(r.status).toBe(401);
  });
});

describe("HTTP server — routing (authenticated)", () => {
  const auth = { Authorization: `Bearer ${TOKEN}` };

  test("POST /messages without sessionId → 400", async () => {
    const r = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: auth,
      body: "{}",
    });
    expect(r.status).toBe(400);
  });

  test("POST /messages with unknown sessionId → 404", async () => {
    const r = await fetch(`${baseUrl}/messages?sessionId=nonexistent`, {
      method: "POST",
      headers: auth,
      body: "{}",
    });
    expect(r.status).toBe(404);
  });

  test("unknown route with valid auth → 404", async () => {
    const r = await fetch(`${baseUrl}/bogus`, { headers: auth });
    expect(r.status).toBe(404);
  });
});

describe("HTTP server — CORS (opt-in)", () => {
  let corsServer: Server;
  let corsClose: () => Promise<void>;
  let corsBaseUrl = "";

  beforeAll(async () => {
    const handle = createHttpServer({ token: TOKEN, corsOrigin: "https://example.com" });
    corsServer = handle.server;
    corsClose = handle.close;
    await new Promise<void>((resolve) => {
      corsServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = corsServer.address() as AddressInfo;
    corsBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await corsClose();
  });

  test("OPTIONS preflight returns CORS headers with 204", async () => {
    const r = await fetch(`${corsBaseUrl}/sse`, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://example.com");
    expect(r.headers.get("access-control-allow-methods")).toContain("POST");
  });

  test("GET /health returns CORS header when enabled", async () => {
    const r = await fetch(`${corsBaseUrl}/health`);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://example.com");
  });

  test("401 response still carries CORS header so browser can read error", async () => {
    const r = await fetch(`${corsBaseUrl}/sse`);
    expect(r.status).toBe(401);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://example.com");
  });
});

describe("HTTP server — default CORS off", () => {
  test("no CORS header when corsOrigin not set", async () => {
    const r = await fetch(`${baseUrl}/health`);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});
