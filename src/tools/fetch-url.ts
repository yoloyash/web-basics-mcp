import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { fetchUrlContent, recommendedFetchConcurrency } from "../content/fetch.js";
import type { ExtractedContent } from "../content/index.js";
import { contentStore, type ContentStore } from "../lib/content-store.js";
import { classifyError, validationError } from "../lib/errors.js";

const MAX_CONTENT_CHARS = 8000;
const MAX_BATCH_URLS = 5;
const BATCH_CONCURRENCY = 3;

export function formatFetchedContent(
  finalUrl: string,
  result: ExtractedContent,
  store: ContentStore = contentStore,
): CallToolResult {
  if (result.extractor === "image") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(formatFetchedPayload(finalUrl, result, store), null, 2),
        },
        {
          type: "image",
          data: Buffer.from(result.data).toString("base64"),
          mimeType: result.contentType,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(formatFetchedPayload(finalUrl, result, store), null, 2),
      },
    ],
  };
}

export function formatFetchedPayload(
  finalUrl: string,
  result: ExtractedContent,
  store: ContentStore = contentStore,
): Record<string, unknown> {
  if (result.extractor === "image") {
    return {
      url: finalUrl,
      contentType: result.contentType,
      byteLength: result.byteLength,
      extractor: result.extractor,
    };
  }

  const content = result.content.slice(0, MAX_CONTENT_CHARS);
  const truncated = result.content.length > MAX_CONTENT_CHARS;
  const payload: Record<string, unknown> = {
    url: finalUrl,
    title: result.title,
    content,
    wordCount: result.wordCount,
    contentType: result.contentType,
    truncated,
    extractor: result.extractor,
  };

  if (truncated) {
    payload.content_id = store.put({
      url: finalUrl,
      title: result.title,
      content: result.content,
      contentType: result.contentType,
      extractor: result.extractor,
    });
    payload.total_chars = result.content.length;
    payload.returned_chars = content.length;
    payload.next_offset = content.length;
  }

  if ("pageCount" in result) {
    payload.pageCount = result.pageCount;
    payload.metadata = result.metadata;
    payload.links = result.links;
  }

  return payload;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export default function registerFetchUrl(server: McpServer) {
  server.registerTool(
    "fetch_url",
    {
      description:
        "Fetch one URL or a small batch of URLs and extract clean markdown from web pages, PDFs, or Reddit posts, or return supported images.",
      inputSchema: {
        url: z.string().url().optional().describe("Target URL"),
        urls: z.array(z.string().url()).min(1).max(MAX_BATCH_URLS).optional().describe("Target URLs"),
      },
    },
    async ({ url, urls }) => {
      try {
        if (url && urls) throw validationError("Use either url or urls, not both");
        if (!url && !urls) throw validationError("Provide url or urls");

        if (url) {
          const { finalUrl, result } = await fetchUrlContent(url);
          return formatFetchedContent(finalUrl, result);
        }

        const inputUrls = urls ?? [];
        const results = await mapWithConcurrency(inputUrls, recommendedFetchConcurrency(inputUrls, BATCH_CONCURRENCY), async (inputUrl) => {
          try {
            const { finalUrl, result } = await fetchUrlContent(inputUrl);
            return {
              inputUrl,
              ok: true,
              result: formatFetchedPayload(finalUrl, result),
            };
          } catch (err) {
            const { category, message, retryable } = classifyError(err);
            return {
              inputUrl,
              ok: false,
              error: {
                category,
                message,
                ...(typeof retryable === "boolean" ? { retryable } : {}),
              },
            };
          }
        });

        const failedCount = results.filter((result) => !result.ok).length;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  results,
                  fetchedCount: results.length - failedCount,
                  failedCount,
                },
                null,
                2,
              ),
            },
          ],
          isError: failedCount === results.length,
        };
      } catch (err) {
        const { category, message, retryable } = classifyError(err);
        const retryHint = typeof retryable === "boolean" ? ` (retryable: ${retryable})` : "";
        return { content: [{ type: "text", text: `${category}: ${message}${retryHint}` }], isError: true };
      }
    },
  );
}
