import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const FETCH_TIMEOUT_MS = 10000;

export default function registerWebSearch(server: McpServer) {
  server.tool(
    "web_search",
    "Search the web. Returns {link, title, snippet}.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().int().min(1).max(10).default(5).describe("Result limit"),
    },
    async ({ query, limit }) => {
      try {
        const u = new URL("/search", process.env.SEARXNG_URL ?? "http://127.0.0.1:8088");
        u.searchParams.set("q", query);
        u.searchParams.set("format", "json");
        u.searchParams.set("safesearch", "1");
        u.searchParams.set("language", "all");

        const res = await fetch(u.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`status ${res.status}`);

        const json = (await res.json()) as {
          results?: Array<{ url: string; title?: string; content?: string }>;
        };

        const results = (json.results ?? []).slice(0, limit).map((r) => ({
          link: r.url,
          title: r.title ?? r.url,
          snippet: r.content ?? "",
        }));

        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Search error: ${err.message}` }], isError: true };
      }
    },
  );
}
