import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  extractFetchedContent,
  fetchByteLimitForContentType,
  type ExtractedContent,
} from "../content/index.js";
import { classifyError } from "../lib/errors.js";
import { fetchPublicHttpUrl, readBytesCapped } from "../lib/http.js";

const MAX_CONTENT_CHARS = 8000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_PDF_FETCH_BYTES = 15 * 1024 * 1024;

export function formatFetchedContent(finalUrl: string, result: ExtractedContent): CallToolResult {
  if (result.extractor === "image") {
    const payload: Record<string, unknown> = {
      url: finalUrl,
      contentType: result.contentType,
      byteLength: result.byteLength,
      extractor: result.extractor,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
        {
          type: "image",
          data: Buffer.from(result.data).toString("base64"),
          mimeType: result.contentType,
        },
      ],
    };
  }

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
}

export default function registerFetchUrl(server: McpServer) {
  server.registerTool(
    "fetch_url",
    {
      description: "Fetch URL and extract clean markdown from web pages or PDFs, or return supported images.",
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
        return formatFetchedContent(finalUrl, result);
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}
