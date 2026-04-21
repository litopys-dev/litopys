export const PACKAGE_NAME = "@litopys/mcp";
export const VERSION = "0.1.0";

export { createServer } from "./server.ts";
export {
  toolSearch,
  toolGet,
  toolCreate,
  toolLink,
  toolRelated,
  graphPath,
  SearchInputSchema,
  GetInputSchema,
  CreateInputSchema,
  LinkInputSchema,
  RelatedInputSchema,
} from "./tools.ts";
export { checkBearer, resolveToken } from "./auth.ts";
export { createHttpServer } from "./http.ts";
export type { HttpServerOptions, HttpServerHandle } from "./http.ts";
export { DEFAULT_INSTRUCTIONS, resolveInstructions } from "./instructions.ts";
export { generateStartupContext } from "./resources.ts";
