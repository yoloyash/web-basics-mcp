import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebBasics } from "../api.js";
import registerFetchUrl from "./fetch-url.js";
import registerWebSearch from "./web-search.js";

export function registerTools(server: McpServer, webBasics: WebBasics): void {
  registerWebSearch(server, webBasics);
  registerFetchUrl(server, webBasics);
}
