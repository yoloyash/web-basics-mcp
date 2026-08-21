import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createWebBasics, type WebBasics } from "./api.js";
import { registerTools } from "./tools/index.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export function createMcpServer(webBasics: WebBasics = createWebBasics()): McpServer {
  const server = new McpServer({ name: "web-basics", version });
  registerTools(server, webBasics);
  return server;
}
