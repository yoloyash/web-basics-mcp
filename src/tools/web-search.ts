import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError, validationError } from "../lib/errors.js";
import { normalizeQuery, searchSearxng } from "../lib/search.js";

const MAX_BATCH_QUERIES = 4;

function formatSearchResults(results: Awaited<ReturnType<typeof searchSearxng>>, limit: number) {
  return results.slice(0, limit).map((r) => ({
    link: r.url,
    title: r.title ?? r.url,
    snippet: r.content ?? "",
  }));
}

export default function registerWebSearch(server: McpServer) {
  server.registerTool(
    "web_search",
    {
      description: "Search the web with one query or a small batch of queries. Returns {link, title, snippet}.",
      inputSchema: {
        query: z.string().optional().describe("Search query"),
        queries: z.array(z.string()).min(1).max(MAX_BATCH_QUERIES).optional().describe("Search queries"),
        limit: z.number().int().min(1).max(10).default(5).describe("Result limit"),
      },
    },
    async ({ query, queries, limit }) => {
      try {
        if (query && queries) throw validationError("Use either query or queries, not both");
        if (!query && !queries) throw validationError("Provide query or queries");

        if (query) {
          const results = formatSearchResults(await searchSearxng(query), limit);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        const normalizedQueries = (queries ?? []).map(normalizeQuery);
        const results = await Promise.all(
          normalizedQueries.map(async (searchQuery) => ({
            query: searchQuery,
            results: formatSearchResults(await searchSearxng(searchQuery), limit),
          })),
        );

        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}
