import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { extractFetchedContent, fetchByteLimitForContentType } from "../content/index.js";
import { classifyError } from "../lib/errors.js";
import { fetchPublicHttpUrl, readBytesCapped } from "../lib/http.js";

const MAX_CONTENT_CHARS = 8000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_PDF_FETCH_BYTES = 15 * 1024 * 1024;

export default function registerFetchUrl(server: McpServer) {
  server.registerTool(
    "fetch_url",
    {
      description: "Fetch URL and extract clean markdown from web pages or PDFs.",
      inputSchema: { url: z.string().url().describe("Target URL") },
    },
    async ({ url }) => {
      try {
        const { res, finalUrl } = await fetchPublicHttpUrl(url);
        if (!res.ok) throw new Error(`HTTP status ${res.status}`);

        const responseContentType = res.headers.get("content-type");
        const body = await readBytesCapped(
          res,
          fetchByteLimitForContentType(responseContentType, MAX_FETCH_BYTES, MAX_PDF_FETCH_BYTES),
        );

        const result = await extractFetchedContent(body, finalUrl, responseContentType);
        const content = result.content.slice(0, MAX_CONTENT_CHARS);
        const payload: Record<string, unknown> = {
          url: finalUrl,
          title: result.title,
          content,
          wordCount: result.wordCount,
          contentType: result.contentType,
          truncated: result.content.length > MAX_CONTENT_CHARS,
          extractor: result.extractor,
        };

        if ("pageCount" in result) {
          payload.pageCount = result.pageCount;
          payload.metadata = result.metadata;
          payload.links = result.links;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      } catch (err) {
        const { category, message, retryable } = classifyError(err);
        const retryHint = typeof retryable === "boolean" ? ` (retryable: ${retryable})` : "";
        return { content: [{ type: "text", text: `${category}: ${message}${retryHint}` }], isError: true };
      }
    },
  );
}
