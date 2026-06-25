import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError } from "../lib/errors.js";
import { DEFAULT_RESEARCH_LIMIT, MAX_RESEARCH_LIMIT, researchQuery } from "../lib/research.js";

export default function registerResearchQuery(server: McpServer) {
  server.registerTool(
    "research_query",
    {
      description: "Search the web, fetch top results, and return a bounded source bundle.",
      inputSchema: {
        query: z.string().describe("Research query"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_RESEARCH_LIMIT)
          .default(DEFAULT_RESEARCH_LIMIT)
          .describe(`Result limit (max ${MAX_RESEARCH_LIMIT})`),
      },
    },
    async ({ query, limit }) => {
      try {
        const result = await researchQuery(query, { limit });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}
