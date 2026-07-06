import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError, validationError } from "../lib/errors.js";
import { normalizeQuery, searchSearxng, type NormalizedQuery, type SearxResult } from "../lib/search.js";

const MAX_BATCH_QUERIES = 4;

type SearchBackend = (query: NormalizedQuery) => Promise<SearxResult[]>;

interface SearchResult {
  link: string;
  title: string;
  snippet: string;
}

interface SearchError {
  category: ReturnType<typeof classifyError>["category"];
  message: string;
  retryable?: boolean;
}

type BatchSearchResult =
  | { query: string; ok: true; results: SearchResult[] }
  | { query: string; ok: false; error: SearchError };

export interface BatchSearchResponse {
  failedCount: number;
  results: BatchSearchResult[];
  searchedCount: number;
}

function formatSearchResults(results: SearxResult[], limit: number): SearchResult[] {
  return results.slice(0, limit).map((r) => ({
    link: r.url,
    title: r.title ?? r.url,
    snippet: r.content ?? "",
  }));
}

export async function searchSingleQuery(
  query: string,
  limit: number,
  search: SearchBackend = searchSearxng,
): Promise<SearchResult[]> {
  const normalizedQuery = normalizeQuery(query);
  return formatSearchResults(await search(normalizedQuery), limit);
}

export async function searchBatchQueries(
  queries: string[],
  limit: number,
  search: SearchBackend = searchSearxng,
): Promise<BatchSearchResponse> {
  const normalizedQueries = queries.map(normalizeQuery);
  const results = await Promise.all(
    normalizedQueries.map(async (searchQuery): Promise<BatchSearchResult> => {
      try {
        return {
          query: searchQuery,
          ok: true,
          results: formatSearchResults(await search(searchQuery), limit),
        };
      } catch (err) {
        const { category, message, retryable } = classifyError(err);
        return {
          query: searchQuery,
          ok: false,
          error: {
            category,
            message,
            ...(typeof retryable === "boolean" ? { retryable } : {}),
          },
        };
      }
    }),
  );
  const failedCount = results.filter((result) => !result.ok).length;
  return {
    results,
    searchedCount: results.length - failedCount,
    failedCount,
  };
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
          const results = await searchSingleQuery(query, limit);
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        const payload = await searchBatchQueries(queries ?? [], limit);

        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          isError: payload.failedCount === payload.results.length,
        };
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}
