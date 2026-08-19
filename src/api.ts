import { fetchUrlContent } from "./content/fetch.js";
import type { ExtractedContent } from "./content/index.js";
import { validationError } from "./lib/errors.js";
import {
  normalizeQuery,
  searchSearxng,
  type NormalizedQuery,
} from "./lib/search.js";

export const DEFAULT_MAX_LENGTH = 8000;
export const MAX_LENGTH = 20000;
export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 10;
export const DEFAULT_SEARXNG_URL = "http://127.0.0.1:8088";

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
) => Promise<SearchResult[]>;

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
  searchProvider?: SearchProvider;
  searxngUrl?: string;
}

export function createWebBasics(options: WebBasicsOptions = {}): WebBasics {
  const searchProvider =
    options.searchProvider ?? createSearxngSearchProvider(options.searxngUrl);

  return {
    webSearch: (input) => webSearch(input, searchProvider),
    fetchUrl,
  };
}

export function createSearxngSearchProvider(
  searxngUrl = DEFAULT_SEARXNG_URL,
): SearchProvider {
  return async (query, signal) => {
    const results = await searchSearxng(
      query as NormalizedQuery,
      searxngUrl,
      signal,
    );
    return results.map((result) => ({
      link: result.url,
      title: result.title ?? result.url,
      snippet: result.content ?? "",
    }));
  };
}

export async function webSearch(
  input: WebSearchInput,
  searchProvider: SearchProvider = createSearxngSearchProvider(),
): Promise<SearchResult[]> {
  const query = normalizeQuery(input.query);
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  validateIntegerRange(limit, "limit", 1, MAX_SEARCH_LIMIT);
  input.signal?.throwIfAborted();
  const results = await searchProvider(query, input.signal);
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
