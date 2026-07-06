import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  extractFetchedContent,
  fetchByteLimitForContentType,
  type ExtractedContent,
} from "../content/index.js";
import { classifyError, validationError } from "../lib/errors.js";
import { fetchPublicHttpUrl, readBytesCapped } from "../lib/http.js";

const MAX_CONTENT_CHARS = 8000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_PDF_FETCH_BYTES = 15 * 1024 * 1024;
const MAX_BATCH_URLS = 5;
const BATCH_CONCURRENCY = 3;

export function formatFetchedContent(finalUrl: string, result: ExtractedContent): CallToolResult {
  if (result.extractor === "image") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(formatFetchedPayload(finalUrl, result), null, 2),
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
        text: JSON.stringify(formatFetchedPayload(finalUrl, result), null, 2),
      },
    ],
  };
}

function formatFetchedPayload(finalUrl: string, result: ExtractedContent): Record<string, unknown> {
  if (result.extractor === "image") {
    return {
      url: finalUrl,
      contentType: result.contentType,
      byteLength: result.byteLength,
      extractor: result.extractor,
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

  return payload;
}

async function fetchAndExtractUrl(url: string): Promise<{ finalUrl: string; result: ExtractedContent }> {
  const { res, finalUrl } = await fetchPublicHttpUrl(url);
  if (!res.ok) throw new Error(`HTTP status ${res.status}`);

  const responseContentType = res.headers.get("content-type");
  const body = await readBytesCapped(
    res,
    fetchByteLimitForContentType(responseContentType, MAX_FETCH_BYTES, MAX_PDF_FETCH_BYTES),
  );

  return { finalUrl, result: await extractFetchedContent(body, finalUrl, responseContentType) };
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
      description: "Fetch one URL or a small batch of URLs and extract clean markdown from web pages or PDFs, or return supported images.",
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
          const { finalUrl, result } = await fetchAndExtractUrl(url);
          return formatFetchedContent(finalUrl, result);
        }

        const results = await mapWithConcurrency(urls ?? [], BATCH_CONCURRENCY, async (inputUrl) => {
          try {
            const { finalUrl, result } = await fetchAndExtractUrl(inputUrl);
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
