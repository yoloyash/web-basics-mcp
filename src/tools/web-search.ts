import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  type WebBasics,
} from "../api.js";
import { classifyError } from "../lib/errors.js";

const searchResultSchema = z.object({
  link: z.string(),
  title: z.string(),
  snippet: z.string(),
});

export default function registerWebSearch(server: McpServer, webBasics: WebBasics) {
  server.registerTool(
    "web_search",
    {
      description: "Search the web through the configured provider. Returns {link, title, snippet}.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_LIMIT).describe("Result limit"),
      },
      outputSchema: {
        results: z.array(searchResultSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit }, { signal }) => {
      try {
        const results = await webBasics.webSearch({ query, limit, signal });
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          structuredContent: { results },
        };
      } catch (err) {
        if (signal.aborted) throw err;
        const { category, message, retryable } = classifyError(err);
        const retryHint = typeof retryable === "boolean" ? ` (retryable: ${retryable})` : "";
        return { content: [{ type: "text", text: `${category}: ${message}${retryHint}` }], isError: true };
      }
    },
  );
}
