import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError } from "../lib/errors.js";
import { searchRedditPosts } from "../lib/reddit.js";

export default function registerRedditSearch(server: McpServer) {
  server.registerTool(
    "reddit_search",
    {
      description: "Search Reddit for posts. Returns post links and discovery metadata. Use reddit_fetch to fetch comments.",
      inputSchema: {
        query: z.string().describe("Search query"),
        subreddit: z.string().optional().describe("Optional subreddit to restrict search to (e.g., programming, AskReddit)"),
        limit: z.number().int().min(1).max(25).default(10).describe("Result limit (max 25)"),
      },
    },
    async ({ query, subreddit, limit }) => {
      try {
        const results = await searchRedditPosts(query, subreddit, limit);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}
