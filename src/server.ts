import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createWebBasics, type WebBasics } from "./api.js";
import { registerTools } from "./tools/index.js";

export function createMcpServer(webBasics: WebBasics = createWebBasics()): McpServer {
  const server = new McpServer({ name: "web-basics", version: "0.1.0" });
  registerTools(server, webBasics);
  return server;
}
