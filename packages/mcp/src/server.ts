import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveInstructions } from "./instructions.ts";
import {
  RESOURCE_DESCRIPTION,
  RESOURCE_MIME_TYPE,
  RESOURCE_NAME,
  RESOURCE_TITLE,
  RESOURCE_URI,
  generateStartupContext,
  isDisabled,
} from "./resources.ts";
import {
  CreateInputSchema,
  GetInputSchema,
  LinkInputSchema,
  RelatedInputSchema,
  SearchInputSchema,
  graphPath,
  toolCreate,
  toolGet,
  toolLink,
  toolRelated,
  toolSearch,
} from "./tools.ts";

function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function mcpOk(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "litopys", version: "0.1.0" },
    { capabilities: {}, instructions: resolveInstructions() },
  );

  server.registerTool(
    "litopys_search",
    {
      description:
        "Full-text search over the Litopys knowledge graph. Returns ranked hits by name, alias, body, and tags.",
      inputSchema: SearchInputSchema,
    },
    async (input) => {
      const result = await toolSearch(input, graphPath());
      if (!result.ok) return mcpError(result.error);
      return mcpOk(result.data);
    },
  );

  server.registerTool(
    "litopys_get",
    {
      description: "Get a node by id or alias, optionally including incident edges.",
      inputSchema: GetInputSchema,
    },
    async (input) => {
      const result = await toolGet(input, graphPath());
      if (!result.ok) return mcpError(result.error);
      return mcpOk(result.data);
    },
  );

  server.registerTool(
    "litopys_create",
    {
      description: "Create a new node in the knowledge graph. Fails if the id already exists.",
      inputSchema: CreateInputSchema,
    },
    async (input) => {
      const result = await toolCreate(input, graphPath());
      if (!result.ok) return mcpError(result.error);
      return mcpOk(result.data);
    },
  );

  server.registerTool(
    "litopys_link",
    {
      description:
        "Add a relation from source node to target node. No-op if the relation already exists.",
      inputSchema: LinkInputSchema,
    },
    async (input) => {
      const result = await toolLink(input, graphPath());
      if (!result.ok) return mcpError(result.error);
      return mcpOk(result.data);
    },
  );

  server.registerTool(
    "litopys_related",
    {
      description:
        "BFS traversal from a node. Returns a subgraph of connected nodes and edges up to the given depth.",
      inputSchema: RelatedInputSchema,
    },
    async (input) => {
      const result = await toolRelated(input, graphPath());
      if (!result.ok) return mcpError(result.error);
      return mcpOk(result.data);
    },
  );

  // ---------------------------------------------------------------------------
  // Resources
  // ---------------------------------------------------------------------------

  if (!isDisabled()) {
    server.registerResource(
      RESOURCE_NAME,
      RESOURCE_URI,
      {
        title: RESOURCE_TITLE,
        description: RESOURCE_DESCRIPTION,
        mimeType: RESOURCE_MIME_TYPE,
      },
      async (_uri) => {
        const text = await generateStartupContext(graphPath());
        return {
          contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text }],
        };
      },
    );
  }

  return server;
}
