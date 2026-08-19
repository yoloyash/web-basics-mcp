import { TtlLruCache } from "./cache.js";
import { validationError } from "./errors.js";

const FETCH_TIMEOUT_MS = 10000;
const MAX_QUERY_LENGTH = 500;
const SEARCH_CACHE_TTL_MS = 2 * 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 100;
const SEARCH_CACHE_MAX_BYTES = 4 * 1024 * 1024;
declare const normalizedQueryBrand: unique symbol;

export type NormalizedQuery = string & { readonly [normalizedQueryBrand]: true };

export interface SearxResult {
  url: string;
  title?: string;
  content?: string;
}

const searchCache = new TtlLruCache<string, SearxResult[]>({
  maxEntries: SEARCH_CACHE_MAX_ENTRIES,
  maxWeight: SEARCH_CACHE_MAX_BYTES,
  ttlMs: SEARCH_CACHE_TTL_MS,
  weigh: (results) => JSON.stringify(results).length * 2,
});

export async function searchSearxng(
  normalizedQuery: NormalizedQuery,
  searxngUrl: string,
  signal?: AbortSignal,
): Promise<SearxResult[]> {
  const url = createSearchUrl(searxngUrl);
  url.searchParams.set("q", normalizedQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "1");
  url.searchParams.set("language", "all");

  return searchCache.getOrLoad(
    url.toString(),
    (loadSignal) => fetchSearchResults(url, loadSignal),
    undefined,
    signal,
  );
}

async function fetchSearchResults(url: URL, signal: AbortSignal): Promise<SearxResult[]> {
  const res = await globalThis.fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
  });
  if (!res.ok) throw new Error(`HTTP status ${res.status} from SearXNG`);

  const json = (await res.json()) as { results?: SearxResult[] };
  return json.results ?? [];
}

export function normalizeQuery(input: string): NormalizedQuery {
  const query = input.trim();
  if (!query) throw validationError("Query cannot be empty");
  if (query.length > MAX_QUERY_LENGTH) throw validationError(`Query cannot exceed ${MAX_QUERY_LENGTH} characters`);
  return query as NormalizedQuery;
}

function createSearchUrl(searxngUrl: string): URL {
  try {
    return new URL("/search", searxngUrl);
  } catch {
    throw validationError("searxngUrl must be a valid URL");
  }
}
