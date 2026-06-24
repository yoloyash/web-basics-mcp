import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError } from "../lib/errors.js";
import { DEFAULT_COMMENT_LIMIT, fetchRedditPost, MAX_COMMENT_LIMIT } from "../lib/reddit.js";

export default function registerRedditFetch(server: McpServer) {
  server.registerTool(
    "reddit_fetch",
    {
      description: "Fetch a Reddit post and comments from its RSS feed. Returns bounded structured JSON.",
      inputSchema: {
        url: z.string().url().describe("Reddit post URL (e.g., https://www.reddit.com/r/subreddit/comments/...)"),
        comments_limit: z
          .number()
          .int()
          .min(0)
          .max(MAX_COMMENT_LIMIT)
          .default(DEFAULT_COMMENT_LIMIT)
          .describe(`Maximum comments to return (max ${MAX_COMMENT_LIMIT})`),
      },
    },
    async ({ url, comments_limit }) => {
      try {
        const result = await fetchRedditPost(url, comments_limit);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}
