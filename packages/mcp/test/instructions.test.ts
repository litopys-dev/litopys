import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFAULT_INSTRUCTIONS, resolveInstructions } from "../src/instructions.ts";
import { createServer } from "../src/server.ts";

// ---------------------------------------------------------------------------
// DEFAULT_INSTRUCTIONS constant
// ---------------------------------------------------------------------------

describe("DEFAULT_INSTRUCTIONS", () => {
  test("is exported and non-empty", () => {
    expect(DEFAULT_INSTRUCTIONS).toBeTruthy();
    expect(DEFAULT_INSTRUCTIONS.length).toBeGreaterThan(100);
  });

  test("mentions litopys_search", () => {
    expect(DEFAULT_INSTRUCTIONS).toContain("litopys_search");
  });

  test("mentions litopys_create", () => {
    expect(DEFAULT_INSTRUCTIONS).toContain("litopys_create");
  });

  test("mentions litopys_link", () => {
    expect(DEFAULT_INSTRUCTIONS).toContain("litopys_link");
  });

  test("describes search-before-answer behaviour", () => {
    const lower = DEFAULT_INSTRUCTIONS.toLowerCase();
    // Should contain "search" close to "answer" or "question"
    expect(lower).toContain("search");
    expect(lower).toContain("answer");
  });

  test("describes create-on-new-fact behaviour", () => {
    const lower = DEFAULT_INSTRUCTIONS.toLowerCase();
    expect(lower).toContain("creat");
    // Stable fact language
    expect(lower).toMatch(/stable|new fact|learn/);
  });

  test("is client-agnostic — mentions multiple clients", () => {
    expect(DEFAULT_INSTRUCTIONS).toContain("Claude Code");
    expect(DEFAULT_INSTRUCTIONS).toContain("Cursor");
    expect(DEFAULT_INSTRUCTIONS).toContain("Cline");
  });

  test("is within reasonable length (800–2000 chars)", () => {
    expect(DEFAULT_INSTRUCTIONS.length).toBeGreaterThanOrEqual(800);
    expect(DEFAULT_INSTRUCTIONS.length).toBeLessThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// resolveInstructions — ENV override
// ---------------------------------------------------------------------------

describe("resolveInstructions", () => {
  const ORIGINAL = process.env.LITOPYS_MCP_INSTRUCTIONS;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.LITOPYS_MCP_INSTRUCTIONS;
    } else {
      process.env.LITOPYS_MCP_INSTRUCTIONS = ORIGINAL;
    }
  });

  test("returns DEFAULT_INSTRUCTIONS when env is not set", () => {
    delete process.env.LITOPYS_MCP_INSTRUCTIONS;
    expect(resolveInstructions()).toBe(DEFAULT_INSTRUCTIONS);
  });

  test("returns ENV value when LITOPYS_MCP_INSTRUCTIONS is set", () => {
    process.env.LITOPYS_MCP_INSTRUCTIONS = "custom instructions text";
    expect(resolveInstructions()).toBe("custom instructions text");
  });

  test("falls back to default when ENV is empty string", () => {
    process.env.LITOPYS_MCP_INSTRUCTIONS = "";
    expect(resolveInstructions()).toBe(DEFAULT_INSTRUCTIONS);
  });

  test("falls back to default when ENV is whitespace-only", () => {
    process.env.LITOPYS_MCP_INSTRUCTIONS = "   ";
    expect(resolveInstructions()).toBe(DEFAULT_INSTRUCTIONS);
  });
});

// ---------------------------------------------------------------------------
// Server init — instructions appear in the initialize response
// ---------------------------------------------------------------------------

describe("createServer — instructions in initialize response", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.LITOPYS_MCP_INSTRUCTIONS;
    delete process.env.LITOPYS_MCP_INSTRUCTIONS;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.LITOPYS_MCP_INSTRUCTIONS;
    } else {
      process.env.LITOPYS_MCP_INSTRUCTIONS = savedEnv;
    }
  });

  test("server returns instructions in initialize response", async () => {
    const mcpServer = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await mcpServer.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    expect(client.getInstructions()).toBe(DEFAULT_INSTRUCTIONS);

    await client.close();
  });

  test("server returns custom instructions when ENV override is set", async () => {
    process.env.LITOPYS_MCP_INSTRUCTIONS = "custom-env-instructions";

    const mcpServer = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await mcpServer.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    expect(client.getInstructions()).toBe("custom-env-instructions");

    await client.close();
  });
});
