import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { classifyError, validationError } from "./errors.js";
import { extractFetchedContent, fetchByteLimitForContentType } from "./extract-content.js";

const MAX_CONTENT_CHARS = 8000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_PDF_FETCH_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10000;

export default function registerFetchUrl(server: McpServer) {
  server.registerTool(
    "fetch_url",
    {
      description: "Fetch URL and extract clean markdown from web pages or PDFs.",
      inputSchema: { url: z.string().url().describe("Target URL") },
    },
    async ({ url }) => {
      try {
        const { res, finalUrl } = await fetchSafe(url);
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
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}

// --- SSRF helpers ---

async function fetchSafe(rawUrl: string, redirects = 0): Promise<{ res: Response; finalUrl: string }> {
  const url = await validatePublicHttpUrl(rawUrl);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "mcp-web-basics/1.0" },
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status >= 300 && res.status < 400) {
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
    const location = res.headers.get("location");
    if (!location) throw new Error("Redirect missing location");
    return fetchSafe(new URL(location, url).toString(), redirects + 1);
  }

  return { res, finalUrl: url.toString() };
}

async function validatePublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw validationError("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw validationError("Unsupported protocol");
  }
  if (url.username || url.password) {
    throw validationError("Credentials not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw validationError("Private hostnames not allowed");
  }

  const records = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (records.length === 0) {
    throw validationError("DNS resolution failed");
  }
  if (
    records.some((r) => {
      try {
        return ipaddr.process(r.address).range() !== "unicast";
      } catch {
        return true;
      }
    })
  ) {
    throw validationError("Private address resolved");
  }

  return url;
}

async function readBytesCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(res.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("Body too large");
  if (!res.body) return new Uint8Array();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Body too large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
