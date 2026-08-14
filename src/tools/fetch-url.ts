import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { fetchUrlContent } from "../content/fetch.js";
import type { ExtractedContent } from "../content/index.js";
import { classifyError, validationError } from "../lib/errors.js";

export const DEFAULT_MAX_LENGTH = 8000;
export const MAX_LENGTH = 20000;

export function formatFetchedContent(
  finalUrl: string,
  result: ExtractedContent,
  startIndex = 0,
  maxLength = DEFAULT_MAX_LENGTH,
): CallToolResult {
  const payload = formatFetchedPayload(finalUrl, result, startIndex, maxLength);
  if (result.extractor !== "image") {
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  return {
    content: [
      { type: "text", text: JSON.stringify(payload, null, 2) },
      {
        type: "image",
        data: Buffer.from(result.data).toString("base64"),
        mimeType: result.contentType,
      },
    ],
  };
}

export function formatFetchedPayload(
  finalUrl: string,
  result: ExtractedContent,
  startIndex = 0,
  maxLength = DEFAULT_MAX_LENGTH,
): Record<string, unknown> {
  if (result.extractor === "image") {
    if (startIndex !== 0) throw validationError("start_index is only supported for text content");
    return {
      url: finalUrl,
      contentType: result.contentType,
      byteLength: result.byteLength,
      extractor: result.extractor,
    };
  }

  const totalChars = result.content.length;
  if (startIndex > totalChars) throw validationError("start_index cannot exceed content length");

  const endIndex = Math.min(startIndex + maxLength, totalChars);
  const content = result.content.slice(startIndex, endIndex);
  const truncated = endIndex < totalChars;
  const payload: Record<string, unknown> = {
    url: finalUrl,
    title: result.title,
    content,
    wordCount: result.wordCount,
    contentType: result.contentType,
    extractor: result.extractor,
    start_index: startIndex,
    returned_chars: content.length,
    total_chars: totalChars,
    truncated,
  };

  if (truncated) payload.next_start_index = endIndex;
  if ("fallbackReason" in result && result.fallbackReason) {
    payload.fallback_reason = result.fallbackReason;
  }
  if ("pageCount" in result) {
    payload.pageCount = result.pageCount;
    payload.metadata = result.metadata;
    payload.links = result.links;
  }

  return payload;
}

export default function registerFetchUrl(server: McpServer) {
  server.registerTool(
    "fetch_url",
    {
      description:
        "Fetch one public HTTP(S) URL. Returns clean Markdown for pages and Reddit posts, extracted PDF text, direct text data, or a supported image. Use start_index to continue truncated text.",
      inputSchema: {
        url: z.string().url().describe("Target URL"),
        start_index: z.number().int().min(0).default(0).describe("Character index to start text content from"),
        max_length: z.number().int().min(1).max(MAX_LENGTH).default(DEFAULT_MAX_LENGTH).describe("Maximum text characters to return"),
      },
    },
    async ({ url, start_index, max_length }) => {
      try {
        const { finalUrl, result } = await fetchUrlContent(url);
        return formatFetchedContent(finalUrl, result, start_index, max_length);
      } catch (err) {
        const { category, message, retryable } = classifyError(err);
        const retryHint = typeof retryable === "boolean" ? ` (retryable: ${retryable})` : "";
        return { content: [{ type: "text", text: `${category}: ${message}${retryHint}` }], isError: true };
      }
    },
  );
}
