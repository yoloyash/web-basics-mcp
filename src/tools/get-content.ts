import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contentStore } from "../lib/content-store.js";
import { classifyError } from "../lib/errors.js";

const DEFAULT_CONTENT_LIMIT = 8000;
const MAX_CONTENT_LIMIT = 20000;

export default function registerGetContent(server: McpServer) {
  server.registerTool(
    "get_content",
    {
      description: "Read stored content from a previous truncated fetch_url result.",
      inputSchema: {
        content_id: z.string().min(1).describe("Stored content ID from fetch_url"),
        offset: z.number().int().min(0).default(0).describe("Character offset to start reading from"),
        limit: z.number().int().min(1).max(MAX_CONTENT_LIMIT).default(DEFAULT_CONTENT_LIMIT).describe("Maximum characters to return"),
      },
    },
    async ({ content_id, offset, limit }) => {
      try {
        const slice = contentStore.slice(content_id, offset, limit);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  content_id: slice.contentId,
                  url: slice.url,
                  title: slice.title,
                  content: slice.content,
                  offset: slice.offset,
                  returned_chars: slice.returnedChars,
                  total_chars: slice.totalChars,
                  next_offset: slice.nextOffset,
                  truncated: slice.truncated,
                  contentType: slice.contentType,
                  extractor: slice.extractor,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}
