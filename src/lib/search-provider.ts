import { TtlLruCache } from "./cache.js";
import { validationError } from "./errors.js";
import { HttpStatusError } from "./http.js";
import {
  SearchProviderError,
  type SearchProviderId,
  type SearchResponse,
  type SearchSource,
} from "./search-types.js";

const MAX_IN_FLIGHT_SEARCHES = 100;
const DEFAULT_PROVIDER_SEARCH_LIMIT = 10;
export const MAX_PROVIDER_SEARCH_LIMIT = 10;
const MAX_RESULT_URL_LENGTH = 4096;
const MAX_RESULT_TITLE_LENGTH = 500;
const MAX_RESULT_SNIPPET_LENGTH = 1000;

export interface SearchSourceCandidate {
  url: string;
  snippet?: string | null;
  title?: string | null;
  publishedDate?: string | null;
  ageSeconds?: number | null;
  author?: string | null;
}

export interface SearchParams {
  query: string;
  limit?: number;
  recency?: "day" | "week" | "month" | "year";
  maxOutputTokens?: number;
  numSearchResults?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly id: SearchProviderId;
  readonly label: string;
  isAvailable(): boolean | Promise<boolean>;
  isExplicitlyAvailable(): boolean | Promise<boolean>;
  search(params: SearchParams): Promise<SearchResponse>;
}

export interface SearchProviderDefinition {
  id: SearchProviderId;
  label: string;
  isAvailable?: () => boolean | Promise<boolean>;
  isExplicitlyAvailable?: () => boolean | Promise<boolean>;
  search: (params: SearchParams) => Promise<Omit<SearchResponse, "provider">>;
}

export function createSearchProvider(
  definition: SearchProviderDefinition,
): SearchProvider {
  return {
    id: definition.id,
    label: definition.label,
    isAvailable: definition.isAvailable ?? (() => true),
    isExplicitlyAvailable:
      definition.isExplicitlyAvailable ??
      definition.isAvailable ??
      (() => true),
    async search(params) {
      params.signal?.throwIfAborted();
      try {
        const response = await definition.search(params);
        params.signal?.throwIfAborted();
        return { provider: definition.id, ...response };
      } catch (error) {
        params.signal?.throwIfAborted();
        if (error instanceof SearchProviderError) throw error;
        const status = error instanceof HttpStatusError ? error.status : undefined;
        throw new SearchProviderError(
          definition.id,
          error instanceof Error ? error.message : String(error),
          status,
          { cause: error },
        );
      }
    },
  };
}

export function coalesceSearchProvider(provider: SearchProvider): SearchProvider {
  const searches = new TtlLruCache<string, SearchResponse>({
    maxEntries: MAX_IN_FLIGHT_SEARCHES,
    ttlMs: 1,
  });

  return {
    ...provider,
    search(params) {
      const requestedLimit = normalizeSearchProviderLimit(
        params.numSearchResults ?? params.limit,
      );
      return searches.getOrLoad(
        JSON.stringify([
          params.query,
          requestedLimit,
          params.recency,
          params.maxOutputTokens,
          params.temperature,
        ]),
        (loadSignal) => provider.search({
          ...params,
          limit: requestedLimit,
          numSearchResults: requestedLimit,
          signal: loadSignal,
        }),
        () => false,
        params.signal,
      );
    },
  };
}

export function normalizeSearchSources(
  candidates: readonly SearchSourceCandidate[],
  limit = DEFAULT_PROVIDER_SEARCH_LIMIT,
): SearchSource[] {
  const sources: SearchSource[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const url = normalizeResultUrl(candidate.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const title = normalizeText(candidate.title) || url;
    const snippet = normalizeText(candidate.snippet);
    const publishedDate = normalizeText(candidate.publishedDate);
    const author = normalizeText(candidate.author);
    sources.push({
      url,
      title: title.slice(0, MAX_RESULT_TITLE_LENGTH),
      ...(snippet
        ? { snippet: snippet.slice(0, MAX_RESULT_SNIPPET_LENGTH) }
        : {}),
      ...(publishedDate ? { publishedDate } : {}),
      ...(typeof candidate.ageSeconds === "number" &&
      Number.isFinite(candidate.ageSeconds) &&
      candidate.ageSeconds >= 0
        ? { ageSeconds: candidate.ageSeconds }
        : {}),
      ...(author ? { author } : {}),
    });
    if (sources.length >= limit) break;
  }

  return sources;
}

export function normalizeSearchProviderLimit(
  limit = DEFAULT_PROVIDER_SEARCH_LIMIT,
): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PROVIDER_SEARCH_LIMIT) {
    throw validationError(
      `limit must be an integer between 1 and ${MAX_PROVIDER_SEARCH_LIMIT}`,
    );
  }
  return limit;
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
