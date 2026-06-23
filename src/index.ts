import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import registerWebSearch from "./tools/web-search.js";
import registerFetchUrl from "./tools/fetch-url.js";

const server = new McpServer({ name: "web-basics-mcp", version: "1.0.0" });

registerWebSearch(server);
registerFetchUrl(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("web-basics-mcp running...");
