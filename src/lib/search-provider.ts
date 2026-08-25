import type { SearchProvider, SearchResult } from "../api.js";
import { TtlLruCache } from "./cache.js";

const MAX_IN_FLIGHT_SEARCHES = 100;
const MAX_RESULT_URL_LENGTH = 4096;
const MAX_RESULT_TITLE_LENGTH = 500;
const MAX_RESULT_SNIPPET_LENGTH = 1000;

export interface SearchResultCandidate {
  link: string;
  snippet?: string | null;
  title?: string | null;
}

export function coalesceSearchProvider(search: SearchProvider): SearchProvider {
  const searches = new TtlLruCache<string, SearchResult[]>({
    maxEntries: MAX_IN_FLIGHT_SEARCHES,
    ttlMs: 1,
  });

  return (query, signal) => searches.getOrLoad(
    query,
    (loadSignal) => search(query, loadSignal),
    () => false,
    signal,
  );
}

export function normalizeSearchResults(
  candidates: readonly SearchResultCandidate[],
  limit = 10,
): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const link = normalizeResultUrl(candidate.link);
    if (!link || seen.has(link)) continue;
    seen.add(link);

    const title = normalizeText(candidate.title) || link;
    const snippet = normalizeText(candidate.snippet);
    results.push({
      link,
      title: title.slice(0, MAX_RESULT_TITLE_LENGTH),
      snippet: snippet.slice(0, MAX_RESULT_SNIPPET_LENGTH),
    });
    if (results.length >= limit) break;
  }

  return results;
}

function normalizeResultUrl(rawUrl: string): string | undefined {
  const value = rawUrl.trim();
  if (!value || value.length > MAX_RESULT_URL_LENGTH) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/gu, " ").trim() ?? "";
}
