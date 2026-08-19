import {
  extractFetchedContent,
  fetchByteLimitForContentType,
  type ExtractedContent,
} from "./index.js";
import { fetchRedditContent } from "./reddit.js";
import { TtlLruCache } from "../lib/cache.js";
import { isRedditUrl } from "../lib/reddit.js";
import { fetchPublicHttpUrl, readBytesCapped } from "../lib/http.js";

const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_PDF_FETCH_BYTES = 15 * 1024 * 1024;
const FETCH_CACHE_TTL_MS = 5 * 60_000;
const FETCH_CACHE_MAX_ENTRIES = 100;
const FETCH_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export interface FetchedUrlContent {
  cacheable?: boolean;
  finalUrl: string;
  result: ExtractedContent;
}

type FetchContent = (
  url: string,
  signal?: AbortSignal,
) => Promise<FetchedUrlContent>;

const fetchCache = new TtlLruCache<string, FetchedUrlContent>({
  maxEntries: FETCH_CACHE_MAX_ENTRIES,
  maxWeight: FETCH_CACHE_MAX_BYTES,
  ttlMs: FETCH_CACHE_TTL_MS,
  weigh: fetchedContentWeight,
});

export async function fetchUrlContent(
  url: string,
  fetchContent: FetchContent = fetchUrlContentUncached,
  signal?: AbortSignal,
): Promise<FetchedUrlContent> {
  const key = normalizeCacheUrl(url);
  const fetched = await fetchCache.getOrLoad(
    key,
    async (loadSignal) => {
      const value = await fetchContent(url, loadSignal);
      const finalKey = normalizeCacheUrl(value.finalUrl);
      if (value.cacheable !== false && finalKey !== key) {
        fetchCache.set(finalKey, value);
      }
      return value;
    },
    (value) => value.cacheable !== false,
    signal,
  );
  return fetched;
}

async function fetchUrlContentUncached(
  url: string,
  signal?: AbortSignal,
): Promise<FetchedUrlContent> {
  if (isRedditUrl(url)) {
    return fetchRedditContent(url, signal);
  }

  const { res, finalUrl } = await fetchPublicHttpUrl(url, { signal });
  const responseContentType = res.headers.get("content-type");
  const body = await readBytesCapped(
    res,
    fetchByteLimitForContentType(responseContentType, MAX_FETCH_BYTES, MAX_PDF_FETCH_BYTES),
    signal,
  );

  signal?.throwIfAborted();
  const result = await extractFetchedContent(body, finalUrl, responseContentType);
  signal?.throwIfAborted();
  if (result.extractor === "image" && result.byteLength > MAX_FETCH_BYTES) {
    throw new Error("Body too large");
  }
  return { cacheable: responseAllowsCaching(res), finalUrl, result };
}

function normalizeCacheUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function fetchedContentWeight(value: FetchedUrlContent): number {
  if (value.result.extractor === "image") return value.result.byteLength;
  return value.result.content.length * 2 + 1024;
}

export function responseAllowsCaching(res: Response): boolean {
  const directives = (res.headers.get("cache-control") ?? "")
    .toLowerCase()
    .split(",")
    .map((directive) => directive.trim());

  return !directives.some(
    (directive) =>
      directive === "no-cache" ||
      directive === "no-store" ||
      /^max-age\s*=\s*0$/u.test(directive),
  );
}
