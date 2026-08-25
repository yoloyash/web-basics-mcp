import { parseHTML } from "linkedom";
import type { SearchProvider } from "../api.js";
import {
  fetchPublicHttpUrl,
  readBytesCapped,
  type FetchPublicHttpOptions,
} from "./http.js";
import {
  coalesceSearchProvider,
  normalizeSearchResults,
  type SearchResultCandidate,
} from "./search-provider.js";

const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 10_000;

type DuckDuckGoDependencies = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "wait"
>;

export function createDuckDuckGoSearchProvider(
  dependencies: DuckDuckGoDependencies = {},
): SearchProvider {
  return coalesceSearchProvider(async (query, signal, limit) => {
    const form = new URLSearchParams({ b: "", kl: "us-en", q: query });
    const { res } = await fetchPublicHttpUrl(DUCKDUCKGO_HTML_URL, {
      ...dependencies,
      body: form.toString(),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      maxRedirects: 0,
      maxTransientRetries: 0,
      method: "POST",
      signal,
      timeoutMs: SEARCH_TIMEOUT_MS,
    });

    const contentType = res.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
      throw new Error(`Unsupported content-type from DuckDuckGo: ${contentType ?? "unknown"}`);
    }
    const html = new TextDecoder().decode(
      await readBytesCapped(res, MAX_RESPONSE_BYTES, signal),
    );
    if (html.includes("anomaly-modal") || html.includes("anomaly.js")) {
      throw new Error("DuckDuckGo blocked the request with a bot-detection challenge");
    }

    return normalizeSearchResults(parseDuckDuckGoResults(html), limit);
  });
}

function parseDuckDuckGoResults(html: string): SearchResultCandidate[] {
  const { document } = parseHTML(html);
  return [...document.querySelectorAll(".result")].flatMap((result) => {
    const anchor = result.querySelector("a.result__a");
    if (!anchor) return [];
    const link = unwrapDuckDuckGoUrl(anchor.getAttribute("href") ?? "");
    if (!link) return [];
    return [{
      link,
      title: anchor.textContent,
      snippet: result.querySelector(".result__snippet")?.textContent,
    }];
  });
}

function unwrapDuckDuckGoUrl(rawHref: string): string | undefined {
  const href = rawHref.trim();
  if (!href) return undefined;
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ?? url.toString();
  } catch {
    return undefined;
  }
}
