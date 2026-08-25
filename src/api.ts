import { fetchUrlContent } from "./content/fetch.js";
import type { ExtractedContent } from "./content/index.js";
import { createBraveSearchProvider } from "./lib/brave-search.js";
import { createDuckDuckGoSearchProvider } from "./lib/duckduckgo-search.js";
import { validationError } from "./lib/errors.js";
import { createExaSearchProvider } from "./lib/exa-search.js";
import { createFirecrawlSearchProvider } from "./lib/firecrawl-search.js";
import {
  normalizeQuery,
  searchSearxng,
  type NormalizedQuery,
} from "./lib/search.js";
import {
  MAX_PROVIDER_SEARCH_LIMIT,
  normalizeSearchProviderLimit,
} from "./lib/search-provider.js";

export const DEFAULT_MAX_LENGTH = 8000;
export const MAX_LENGTH = 20000;
export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = MAX_PROVIDER_SEARCH_LIMIT;
export const DEFAULT_SEARXNG_URL = "http://127.0.0.1:8088";
export type SearchBackend =
  | "auto"
  | "brave"
  | "duckduckgo"
  | "exa"
  | "firecrawl"
  | "searxng";

export interface WebSearchInput {
  query: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface SearchResult {
  link: string;
  title: string;
  snippet: string;
}

export type SearchProvider = (
  query: string,
  signal?: AbortSignal,
  limit?: number,
) => Promise<SearchResult[]>;

export interface SearchProviderEntry {
  name: string;
  search: SearchProvider;
}

export interface FetchUrlInput {
  url: string;
  startIndex?: number;
  maxLength?: number;
  signal?: AbortSignal;
}

export interface FetchTextResult {
  kind: "text";
  url: string;
  title: string;
  content: string;
  wordCount: number;
  contentType: string;
  extractor: "defuddle" | "readability" | "unpdf" | "reddit" | "text";
  startIndex: number;
  returnedChars: number;
  totalChars: number;
  truncated: boolean;
  nextStartIndex?: number;
  fallbackReason?: string;
  pageCount?: number;
  metadata?: Record<string, string | number | boolean | null>;
  links?: string[];
}

export interface FetchImageResult {
  kind: "image";
  url: string;
  data: Uint8Array;
  byteLength: number;
  contentType: string;
  extractor: "image";
}

export type FetchUrlResult = FetchTextResult | FetchImageResult;

export interface WebBasics {
  webSearch(input: WebSearchInput): Promise<SearchResult[]>;
  fetchUrl(input: FetchUrlInput): Promise<FetchUrlResult>;
}

export interface WebBasicsOptions {
  braveApiKey?: string;
  searchBackend?: SearchBackend;
  searchProvider?: SearchProvider;
  searxngUrl?: string;
}

export function createWebBasics(options: WebBasicsOptions = {}): WebBasics {
  const searchProvider =
    options.searchProvider ?? createConfiguredSearchProvider(options);

  return {
    webSearch: (input) => webSearch(input, searchProvider),
    fetchUrl,
  };
}

export {
  createBraveSearchProvider,
  createDuckDuckGoSearchProvider,
  createExaSearchProvider,
  createFirecrawlSearchProvider,
};

export function createFallbackSearchProvider(
  providers: readonly SearchProviderEntry[],
): SearchProvider {
  if (providers.length === 0) {
    throw validationError("At least one search provider is required");
  }

  return async (query, signal, limit) => {
    const attempts: SearchProviderAttempt[] = [];

    for (const provider of providers) {
      signal?.throwIfAborted();
      try {
        const results = await provider.search(query, signal, limit);
        signal?.throwIfAborted();
        if (results.length > 0) return results;
        attempts.push({ name: provider.name, outcome: "empty" });
      } catch (error) {
        signal?.throwIfAborted();
        attempts.push({ error, name: provider.name, outcome: "failed" });
      }
    }

    const failures = attempts.filter(isFailedSearchAttempt);
    if (failures.length === 0) return [];
    const allFailed = failures.length === attempts.length;
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `${allFailed ? "All search providers failed" : "No search provider returned results"}: ${attempts
        .map((attempt) => attempt.outcome === "failed"
          ? `${attempt.name}: ${errorMessage(attempt.error)}`
          : `${attempt.name}: returned no results`)
        .join("; ")}`,
    );
  };
}

type SearchProviderAttempt =
  | { error: unknown; name: string; outcome: "failed" }
  | { name: string; outcome: "empty" };

function isFailedSearchAttempt(
  attempt: SearchProviderAttempt,
): attempt is Extract<SearchProviderAttempt, { outcome: "failed" }> {
  return attempt.outcome === "failed";
}

export function createSearxngSearchProvider(
  searxngUrl = DEFAULT_SEARXNG_URL,
): SearchProvider {
  return async (query, signal, limit) => {
    const results = await searchSearxng(
      query as NormalizedQuery,
      searxngUrl,
      signal,
    );
    return results.map((result) => ({
      link: result.url,
      title: result.title ?? result.url,
      snippet: result.content ?? "",
    })).slice(0, normalizeSearchProviderLimit(limit));
  };
}

function createConfiguredSearchProvider(options: WebBasicsOptions): SearchProvider {
  const backend = options.searchBackend ?? "searxng";
  if (backend === "auto") {
    const providers: SearchProviderEntry[] = [];
    if (options.braveApiKey?.trim()) {
      providers.push({
        name: "brave",
        search: createBraveSearchProvider(options.braveApiKey),
      });
    }
    if (options.searxngUrl?.trim()) {
      providers.push({
        name: "searxng",
        search: createSearxngSearchProvider(options.searxngUrl),
      });
    }
    providers.push(
      { name: "firecrawl", search: createFirecrawlSearchProvider() },
      { name: "exa", search: createExaSearchProvider() },
      { name: "duckduckgo", search: createDuckDuckGoSearchProvider() },
    );
    return createFallbackSearchProvider(providers);
  }
  if (backend === "brave") {
    return createBraveSearchProvider(options.braveApiKey ?? "");
  }
  if (backend === "searxng") {
    return createSearxngSearchProvider(options.searxngUrl);
  }
  if (backend === "firecrawl") return createFirecrawlSearchProvider();
  if (backend === "exa") return createExaSearchProvider();
  if (backend === "duckduckgo") return createDuckDuckGoSearchProvider();
  throw validationError(`Unsupported search backend: ${String(backend)}`);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, " ").trim().slice(0, 500);
}

export async function webSearch(
  input: WebSearchInput,
  searchProvider: SearchProvider = createSearxngSearchProvider(),
): Promise<SearchResult[]> {
  const query = normalizeQuery(input.query);
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  validateIntegerRange(limit, "limit", 1, MAX_SEARCH_LIMIT);
  input.signal?.throwIfAborted();
  const results = await searchProvider(query, input.signal, limit);
  return results.slice(0, limit);
}

export async function fetchUrl(input: FetchUrlInput): Promise<FetchUrlResult> {
  const startIndex = input.startIndex ?? 0;
  const maxLength = input.maxLength ?? DEFAULT_MAX_LENGTH;
  validateIntegerRange(startIndex, "startIndex", 0);
  validateIntegerRange(maxLength, "maxLength", 1, MAX_LENGTH);

  input.signal?.throwIfAborted();
  const { finalUrl, result } = await fetchUrlContent(
    input.url,
    undefined,
    input.signal,
  );
  input.signal?.throwIfAborted();
  return createFetchUrlResult(finalUrl, result, startIndex, maxLength);
}

export function createFetchUrlResult(
  finalUrl: string,
  result: ExtractedContent,
  startIndex = 0,
  maxLength = DEFAULT_MAX_LENGTH,
): FetchUrlResult {
  validateIntegerRange(startIndex, "startIndex", 0);
  validateIntegerRange(maxLength, "maxLength", 1, MAX_LENGTH);

  if (result.extractor === "image") {
    if (startIndex !== 0) {
      throw validationError("startIndex is only supported for text content");
    }
    return {
      kind: "image",
      url: finalUrl,
      data: result.data,
      byteLength: result.byteLength,
      contentType: result.contentType,
      extractor: result.extractor,
    };
  }

  const totalChars = result.content.length;
  if (startIndex > totalChars) {
    throw validationError("startIndex cannot exceed content length");
  }

  const endIndex = Math.min(startIndex + maxLength, totalChars);
  const output: FetchTextResult = {
    kind: "text",
    url: finalUrl,
    title: result.title,
    content: result.content.slice(startIndex, endIndex),
    wordCount: result.wordCount,
    contentType: result.contentType,
    extractor: result.extractor,
    startIndex,
    returnedChars: endIndex - startIndex,
    totalChars,
    truncated: endIndex < totalChars,
  };

  if (output.truncated) output.nextStartIndex = endIndex;
  if ("fallbackReason" in result && result.fallbackReason) {
    output.fallbackReason = result.fallbackReason;
  }
  if ("pageCount" in result) {
    output.pageCount = result.pageCount;
    output.metadata = result.metadata;
    output.links = result.links;
  }

  return output;
}

function validateIntegerRange(
  value: number,
  name: string,
  minimum: number,
  maximum?: number,
): void {
  if (!Number.isInteger(value)) throw validationError(`${name} must be an integer`);
  if (value < minimum) throw validationError(`${name} must be at least ${minimum}`);
  if (maximum !== undefined && value > maximum) {
    throw validationError(`${name} cannot exceed ${maximum}`);
  }
}
