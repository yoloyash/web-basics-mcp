import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { classifyError, validationError } from "./errors.js";
import { extractReadableMarkdown } from "./extract-readable.js";

const MAX_CONTENT_CHARS = 8000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10000;

export default function registerFetchUrl(server: McpServer) {
  server.tool(
    "fetch_url",
    "Fetch URL and extract clean markdown.",
    { url: z.string().url().describe("Target URL") },
    async ({ url }) => {
      try {
        const { res, finalUrl } = await fetchSafe(url);
        if (!res.ok) throw new Error(`HTTP status ${res.status}`);

        assertReadableContentType(res);
        const html = await readTextCapped(res);

        const result = extractReadableMarkdown(html, finalUrl);
        const content = result.content.slice(0, MAX_CONTENT_CHARS);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  url: finalUrl,
                  title: result.title ?? finalUrl,
                  content,
                  wordCount: result.wordCount,
                  extractor: result.extractor,
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

function assertReadableContentType(res: Response): void {
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType) return;
  if (contentType.startsWith("text/") || contentType.includes("html") || contentType.includes("xml")) return;
  throw new Error(`Unsupported content-type: ${contentType}`);
}

async function readTextCapped(res: Response): Promise<string> {
  const declaredLength = Number(res.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_FETCH_BYTES) throw new Error("Body too large");
  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
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
  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}
