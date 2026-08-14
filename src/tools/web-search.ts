import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError } from "../lib/errors.js";
import { normalizeQuery, searchSearxng, type NormalizedQuery, type SearxResult } from "../lib/search.js";

type SearchBackend = (query: NormalizedQuery) => Promise<SearxResult[]>;

export interface SearchResult {
  link: string;
  title: string;
  snippet: string;
}

export async function searchSingleQuery(
  query: string,
  limit: number,
  search: SearchBackend = searchSearxng,
): Promise<SearchResult[]> {
  const normalizedQuery = normalizeQuery(query);
  const results = await search(normalizedQuery);
  return results.slice(0, limit).map((result) => ({
    link: result.url,
    title: result.title ?? result.url,
    snippet: result.content ?? "",
  }));
}

export default function registerWebSearch(server: McpServer) {
  server.registerTool(
    "web_search",
    {
      description: "Search the web through the configured SearXNG instance. Returns {link, title, snippet}.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(10).default(5).describe("Result limit"),
      },
    },
    async ({ query, limit }) => {
      try {
        const results = await searchSingleQuery(query, limit);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      } catch (err) {
        const { category, message, retryable } = classifyError(err);
        const retryHint = typeof retryable === "boolean" ? ` (retryable: ${retryable})` : "";
        return { content: [{ type: "text", text: `${category}: ${message}${retryHint}` }], isError: true };
      }
    },
  );
}
