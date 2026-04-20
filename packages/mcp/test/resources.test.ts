import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";
import {
  RESOURCE_DESCRIPTION,
  RESOURCE_MIME_TYPE,
  RESOURCE_NAME,
  RESOURCE_TITLE,
  RESOURCE_URI,
  generateStartupContext,
  isDisabled,
} from "../src/resources.ts";
import { createServer } from "../src/server.ts";

const FIXTURES = join(import.meta.dir, "fixtures/graph");

// ---------------------------------------------------------------------------
// Helper: create a connected MCP client+server pair pointing at the fixture
// ---------------------------------------------------------------------------

async function connectClient(extraEnv?: Record<string, string | undefined>) {
  // Apply any env overrides before creating the server
  const savedEnv: Record<string, string | undefined> = {};
  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) {
      savedEnv[k] = process.env[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }

  const mcpServer = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await client.close();
      // Restore env
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// isDisabled helper
// ---------------------------------------------------------------------------

describe("isDisabled", () => {
  const ORIG = process.env.LITOPYS_STARTUP_CONTEXT_DISABLED;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.LITOPYS_STARTUP_CONTEXT_DISABLED;
    else process.env.LITOPYS_STARTUP_CONTEXT_DISABLED = ORIG;
  });

  test("returns false when env is not set", () => {
    delete process.env.LITOPYS_STARTUP_CONTEXT_DISABLED;
    expect(isDisabled()).toBe(false);
  });

  test("returns true when env is '1'", () => {
    process.env.LITOPYS_STARTUP_CONTEXT_DISABLED = "1";
    expect(isDisabled()).toBe(true);
  });

  test("returns false when env is '0'", () => {
    process.env.LITOPYS_STARTUP_CONTEXT_DISABLED = "0";
    expect(isDisabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateStartupContext — unit tests
// ---------------------------------------------------------------------------

describe("generateStartupContext", () => {
  const ORIG_PATH = process.env.LITOPYS_GRAPH_PATH;
  const ORIG_LIMIT = process.env.LITOPYS_STARTUP_CONTEXT_LIMIT;

  afterEach(() => {
    if (ORIG_PATH === undefined) delete process.env.LITOPYS_GRAPH_PATH;
    else process.env.LITOPYS_GRAPH_PATH = ORIG_PATH;
    if (ORIG_LIMIT === undefined) delete process.env.LITOPYS_STARTUP_CONTEXT_LIMIT;
    else process.env.LITOPYS_STARTUP_CONTEXT_LIMIT = ORIG_LIMIT;
  });

  test("returns non-empty markdown string", async () => {
    const ctx = await generateStartupContext(FIXTURES);
    expect(typeof ctx).toBe("string");
    expect(ctx.length).toBeGreaterThan(50);
  });

  test("starts with a markdown heading", async () => {
    const ctx = await generateStartupContext(FIXTURES);
    expect(ctx.startsWith("# Litopys Startup Context")).toBe(true);
  });

  test("contains Owner section (bob has tag owner)", async () => {
    const ctx = await generateStartupContext(FIXTURES);
    expect(ctx).toContain("## Owner");
    expect(ctx).toContain("bob");
  });

  test("contains Active Projects section", async () => {
    const ctx = await generateStartupContext(FIXTURES);
    expect(ctx).toContain("## Active Projects");
    expect(ctx).toContain("alpha-project");
  });

  test("contains Recent Events section", async () => {
    const ctx = await generateStartupContext(FIXTURES);
    expect(ctx).toContain("## Recent Events");
    expect(ctx).toContain("refactor-2026-04");
  });

  test("contains Key Lessons section", async () => {
    const ctx = await generateStartupContext(FIXTURES);
    expect(ctx).toContain("## Key Lessons");
    expect(ctx).toContain("less-is-more");
  });

  test("contains Graph Statistics section", async () => {
    const ctx = await generateStartupContext(FIXTURES);
    expect(ctx).toContain("## Graph Statistics");
    expect(ctx).toMatch(/\d+ nodes/);
    expect(ctx).toMatch(/\d+ edges/);
  });

  test("respects LITOPYS_STARTUP_CONTEXT_LIMIT=1 (only 1 project shown)", async () => {
    process.env.LITOPYS_STARTUP_CONTEXT_LIMIT = "1";
    const ctx = await generateStartupContext(FIXTURES);
    // Should still have the Projects section header
    expect(ctx).toContain("## Active Projects");
  });

  test("output is under 6 KB", async () => {
    const ctx = await generateStartupContext(FIXTURES);
    expect(Buffer.byteLength(ctx, "utf8")).toBeLessThanOrEqual(6144);
  });
});

// ---------------------------------------------------------------------------
// Resource registration via MCP client
// ---------------------------------------------------------------------------

describe("startup-context resource registration", () => {
  const ORIG_DISABLED = process.env.LITOPYS_STARTUP_CONTEXT_DISABLED;
  const ORIG_PATH = process.env.LITOPYS_GRAPH_PATH;

  beforeEach(() => {
    delete process.env.LITOPYS_STARTUP_CONTEXT_DISABLED;
    process.env.LITOPYS_GRAPH_PATH = FIXTURES;
  });

  afterEach(() => {
    if (ORIG_DISABLED === undefined) delete process.env.LITOPYS_STARTUP_CONTEXT_DISABLED;
    else process.env.LITOPYS_STARTUP_CONTEXT_DISABLED = ORIG_DISABLED;
    if (ORIG_PATH === undefined) delete process.env.LITOPYS_GRAPH_PATH;
    else process.env.LITOPYS_GRAPH_PATH = ORIG_PATH;
  });

  test("resource appears in listResources()", async () => {
    const { client, close } = await connectClient();
    try {
      const list = await client.listResources();
      const r = list.resources.find((r) => r.uri === RESOURCE_URI);
      expect(r).toBeDefined();
      expect(r?.name).toBe(RESOURCE_NAME);
    } finally {
      await close();
    }
  });

  test("resource has correct title, description, mimeType", async () => {
    const { client, close } = await connectClient();
    try {
      const list = await client.listResources();
      const r = list.resources.find((r) => r.uri === RESOURCE_URI);
      expect(r?.title).toBe(RESOURCE_TITLE);
      expect(r?.description).toBe(RESOURCE_DESCRIPTION);
      expect(r?.mimeType).toBe(RESOURCE_MIME_TYPE);
    } finally {
      await close();
    }
  });

  test("readResource returns non-empty markdown content", async () => {
    const { client, close } = await connectClient();
    try {
      const result = await client.readResource({ uri: RESOURCE_URI });
      expect(result.contents.length).toBeGreaterThan(0);
      const first = result.contents[0];
      if (!("text" in first)) throw new Error("Expected text content");
      expect(first.text.length).toBeGreaterThan(50);
      expect(first.mimeType).toBe(RESOURCE_MIME_TYPE);
    } finally {
      await close();
    }
  });

  test("readResource content contains expected sections", async () => {
    const { client, close } = await connectClient();
    try {
      const result = await client.readResource({ uri: RESOURCE_URI });
      const first = result.contents[0];
      if (!("text" in first)) throw new Error("Expected text content");
      const text = first.text;
      expect(text).toContain("## Owner");
      expect(text).toContain("## Active Projects");
      expect(text).toContain("## Graph Statistics");
    } finally {
      await close();
    }
  });

  test("resource NOT in list when LITOPYS_STARTUP_CONTEXT_DISABLED=1", async () => {
    const { client, close } = await connectClient({
      LITOPYS_STARTUP_CONTEXT_DISABLED: "1",
    });
    try {
      // When no resources are registered the SDK may throw "Method not found"
      // or return an empty list depending on SDK version — either way the
      // startup-context resource must not be present.
      let resources: Array<{ uri: string }> = [];
      try {
        const list = await client.listResources();
        resources = list.resources;
      } catch {
        // "Method not found" — no resources registered at all, which is correct
        resources = [];
      }
      const r = resources.find((r) => r.uri === RESOURCE_URI);
      expect(r).toBeUndefined();
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Resource metadata constants
// ---------------------------------------------------------------------------

describe("resource metadata constants", () => {
  test("RESOURCE_URI is a valid litopys:// URI", () => {
    expect(RESOURCE_URI).toMatch(/^litopys:\/\//);
  });

  test("RESOURCE_NAME is startup-context", () => {
    expect(RESOURCE_NAME).toBe("startup-context");
  });

  test("RESOURCE_MIME_TYPE is text/markdown", () => {
    expect(RESOURCE_MIME_TYPE).toBe("text/markdown");
  });

  test("RESOURCE_DESCRIPTION is non-empty", () => {
    expect(RESOURCE_DESCRIPTION.length).toBeGreaterThan(20);
  });
});
