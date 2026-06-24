import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError, validationError } from "./errors.js";

const FETCH_TIMEOUT_MS = 10000;
const MAX_QUERY_LENGTH = 500;

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
        const normalizedQuery = normalizeQuery(query);
        const u = createSearchUrl();
        u.searchParams.set("q", normalizedQuery);
        u.searchParams.set("format", "json");
        u.searchParams.set("safesearch", "1");
        u.searchParams.set("language", "all");

        const res = await fetch(u.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP status ${res.status} from SearXNG`);

        const json = (await res.json()) as {
          results?: Array<{ url: string; title?: string; content?: string }>;
        };

        const results = (json.results ?? []).slice(0, limit).map((r) => ({
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

function normalizeQuery(input: string): string {
  const query = input.trim();
  if (!query) throw validationError("Query cannot be empty");
  if (query.length > MAX_QUERY_LENGTH) throw validationError(`Query cannot exceed ${MAX_QUERY_LENGTH} characters`);
  return query;
}

function createSearchUrl(): URL {
  try {
    return new URL("/search", process.env.SEARXNG_URL ?? "http://127.0.0.1:8088");
  } catch {
    throw validationError("SEARXNG_URL must be a valid URL");
  }
}
