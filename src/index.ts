#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import registerWebSearch from "./tools/web-search.js";
import registerFetchUrl from "./tools/fetch-url.js";
import registerRedditSearch from "./tools/reddit-search.js";
import registerRedditFetch from "./tools/reddit-fetch.js";

const server = new McpServer({ name: "web-basics-mcp", version: "1.0.0" });

registerWebSearch(server);
registerFetchUrl(server);
registerRedditSearch(server);
registerRedditFetch(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("web-basics-mcp running...");
