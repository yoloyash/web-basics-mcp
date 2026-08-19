import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  DEFAULT_MAX_LENGTH,
  MAX_LENGTH,
  type FetchUrlResult,
  type WebBasics,
} from "../api.js";
import { classifyError } from "../lib/errors.js";

const extractorSchema = z.enum([
  "defuddle",
  "readability",
  "unpdf",
  "reddit",
  "text",
  "image",
]);

const metadataValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export function formatFetchedContent(result: FetchUrlResult): CallToolResult {
  const payload = formatFetchedPayload(result);
  if (result.kind !== "image") {
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
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
    structuredContent: payload,
  };
}

export function formatFetchedPayload(result: FetchUrlResult): Record<string, unknown> {
  if (result.kind === "image") {
    return {
      url: result.url,
      contentType: result.contentType,
      byteLength: result.byteLength,
      extractor: result.extractor,
    };
  }

  const payload: Record<string, unknown> = {
    url: result.url,
    title: result.title,
    content: result.content,
    wordCount: result.wordCount,
    contentType: result.contentType,
    extractor: result.extractor,
    start_index: result.startIndex,
    returned_chars: result.returnedChars,
    total_chars: result.totalChars,
    truncated: result.truncated,
  };

  if (result.nextStartIndex !== undefined) {
    payload.next_start_index = result.nextStartIndex;
  }
  if (result.fallbackReason) {
    payload.fallback_reason = result.fallbackReason;
  }
  if (result.pageCount !== undefined) {
    payload.pageCount = result.pageCount;
    payload.metadata = result.metadata;
    payload.links = result.links;
  }

  return payload;
}

export default function registerFetchUrl(server: McpServer, webBasics: WebBasics) {
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
      outputSchema: {
        url: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        wordCount: z.number().int().min(0).optional(),
        contentType: z.string(),
        extractor: extractorSchema,
        start_index: z.number().int().min(0).optional(),
        returned_chars: z.number().int().min(0).optional(),
        total_chars: z.number().int().min(0).optional(),
        truncated: z.boolean().optional(),
        next_start_index: z.number().int().min(0).optional(),
        fallback_reason: z.string().optional(),
        pageCount: z.number().int().min(1).optional(),
        metadata: z.record(metadataValueSchema).optional(),
        links: z.array(z.string()).optional(),
        byteLength: z.number().int().min(0).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, start_index, max_length }, { signal }) => {
      try {
        const result = await webBasics.fetchUrl({
          url,
          startIndex: start_index,
          maxLength: max_length,
          signal,
        });
        return formatFetchedContent(result);
      } catch (err) {
        if (signal.aborted) throw err;
        const { category, message, retryable } = classifyError(err);
        const retryHint = typeof retryable === "boolean" ? ` (retryable: ${retryable})` : "";
        return { content: [{ type: "text", text: `${category}: ${message}${retryHint}` }], isError: true };
      }
    },
  );
}
