import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import registerFetchUrl from "./fetch-url.js";
import registerGetContent from "./get-content.js";
import registerRedditFetch from "./reddit-fetch.js";
import registerWebSearch from "./web-search.js";

export function registerTools(server: McpServer): void {
  registerWebSearch(server);
  registerFetchUrl(server);
  registerGetContent(server);
  registerRedditFetch(server);
}
