import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError } from "../lib/errors.js";
import { searchSearxng } from "../lib/search.js";

export default function registerWebSearch(server: McpServer) {
  server.registerTool(
    "web_search",
    {
      description: "Search the web. Returns {link, title, snippet}.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(10).default(5).describe("Result limit"),
      },
    },
    async ({ query, limit }) => {
      try {
        const results = (await searchSearxng(query)).slice(0, limit).map((r) => ({
          link: r.url,
          title: r.title ?? r.url,
          snippet: r.content ?? "",
        }));

        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}
