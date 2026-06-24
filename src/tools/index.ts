import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import registerFetchUrl from "./fetch-url.js";
import registerRedditFetch from "./reddit-fetch.js";
import registerRedditSearch from "./reddit-search.js";
import registerWebSearch from "./web-search.js";

export function registerTools(server: McpServer): void {
  registerWebSearch(server);
  registerFetchUrl(server);
  registerRedditSearch(server);
  registerRedditFetch(server);
}
