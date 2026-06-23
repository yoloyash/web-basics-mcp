import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://127.0.0.1:8088";
const MAX_CONTENT_CHARS = 8000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10000;

const server = new McpServer({
  name: "web-basics-mcp",
  version: "1.0.0",
});

server.tool(
  "web_search",
  "Search the web. Returns {link, title, snippet}.",
  {
    query: z.string().describe("Search query"),
    limit: z.number().int().min(1).max(10).default(5).describe("Result limit"),
  },
  async ({ query, limit }) => {
    try {
      const u = new URL("/search", SEARXNG_URL);
      u.searchParams.set("q", query);
      u.searchParams.set("format", "json");
      u.searchParams.set("safesearch", "1");
      u.searchParams.set("language", "all");

      const res = await fetch(u.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`status ${res.status}`);

      const json = (await res.json()) as {
        results?: Array<{ url: string; title?: string; content?: string }>;
      };

      const results = (json.results ?? []).slice(0, limit).map((r) => ({
        link: r.url,
        title: r.title ?? r.url,
        snippet: r.content ?? "",
      }));

      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Search error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "fetch_url",
  "Fetch URL and extract clean markdown.",
  {
    url: z.string().url().describe("Target URL"),
  },
  async ({ url }) => {
    try {
      const { res, finalUrl } = await fetchSafe(url);
      if (!res.ok) throw new Error(`status ${res.status}`);

      assertReadableContentType(res);
      const html = await readTextCapped(res);

      const { document } = parseHTML(html);
      const result = await Defuddle(document as unknown as Document, finalUrl, { markdown: true });
      const content = (result.content ?? "").slice(0, MAX_CONTENT_CHARS);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              url: finalUrl,
              title: result.title ?? finalUrl,
              content,
              wordCount: result.wordCount ?? 0,
            }, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Fetch error: ${err.message}` }], isError: true };
    }
  }
);

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
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported protocol");
  }
  if (url.username || url.password) {
    throw new Error("Credentials not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Private hostnames not allowed");
  }

  const records = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (records.length === 0) throw new Error("DNS resolution failed");
  if (records.some((r) => {
    try {
      return ipaddr.process(r.address).range() !== "unicast";
    } catch {
      return true;
    }
  })) {
    throw new Error("Private address resolved");
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("web-basics-mcp running...");
