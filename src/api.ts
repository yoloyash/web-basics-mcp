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
  createSearchProvider,
  normalizeSearchProviderLimit,
  normalizeSearchSources,
  type SearchParams,
  type SearchProvider,
} from "./lib/search-provider.js";
import {
  SearchProviderError,
  type SearchCitation,
  type SearchProviderId,
  type SearchProviderPreference,
  type SearchResponse,
  type SearchSource,
  type SearchUsage,
} from "./lib/search-types.js";

export const DEFAULT_MAX_LENGTH = 8000;
export const MAX_LENGTH = 20000;
export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = MAX_PROVIDER_SEARCH_LIMIT;
export const DEFAULT_SEARXNG_URL = "http://127.0.0.1:8088";
const MAX_SEARCH_PROVIDER_ERROR_LENGTH = 500;
const MAX_SEARCH_CHAIN_ERROR_LENGTH = 4000;
export type SearchBackend = SearchProviderPreference;

export interface WebSearchInput {
  query: string;
  limit?: number;
  recency?: "day" | "week" | "month" | "year";
  maxTokens?: number;
  numSearchResults?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export {
  SearchProviderError,
  type SearchCitation,
  type SearchParams,
  type SearchProvider,
  type SearchProviderId,
  type SearchResponse,
  type SearchSource,
  type SearchUsage,
};

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
  webSearch(input: WebSearchInput): Promise<SearchResponse>;
  fetchUrl(input: FetchUrlInput): Promise<FetchUrlResult>;
}

export interface WebBasicsOptions {
  allowKeylessFallback?: boolean;
  braveApiKey?: string;
  searchBackend?: SearchBackend;
  searchProvider?: SearchProvider;
  searxngUrl?: string;
}

export function createWebBasics(options: WebBasicsOptions = {}): WebBasics {
  const candidates = options.searchProvider
    ? [{ explicit: true, provider: options.searchProvider }]
    : createConfiguredSearchCandidates(options);

  return {
    webSearch: (input) => executeWebSearch(input, candidates),
    fetchUrl,
  };
}

export {
  createBraveSearchProvider,
  createDuckDuckGoSearchProvider,
  createExaSearchProvider,
  createFirecrawlSearchProvider,
};

export function createSearxngSearchProvider(
  searxngUrl = DEFAULT_SEARXNG_URL,
): SearchProvider {
  return createSearchProvider({
    id: "searxng",
    label: "SearXNG",
    async search(params) {
      const limit = normalizeSearchProviderLimit(
        params.numSearchResults ?? params.limit,
      );
      const response = await searchSearxng(
        params.query as NormalizedQuery,
        searxngUrl,
        params.signal,
        params.recency,
      );
      const sources = normalizeSearchSources(response.results.map((result) => ({
          url: result.url,
          title: result.title,
          snippet: result.content,
          publishedDate: result.publishedDate,
          ageSeconds: dateToAgeSeconds(result.publishedDate),
          author: result.author,
        })), limit);
      const answer = formatSearxngAnswers(response.answers);
      const relatedQuestions = response.suggestions?.flatMap((question) => {
        const normalized = question.trim();
        return normalized ? [normalized] : [];
      }).slice(0, limit);
      if (
        sources.length === 0 &&
        !answer &&
        !relatedQuestions?.length &&
        response.unresponsiveEngines?.length
      ) {
        throw new SearchProviderError(
          "searxng",
          `SearXNG returned no usable results; upstream engines failed: ${response.unresponsiveEngines
            .map(([engine, reason]) => `${engine}: ${reason}`)
            .join("; ")}`,
          503,
        );
      }
      return {
        sources,
        ...(answer ? { answer } : {}),
        ...(relatedQuestions?.length ? {
          relatedQuestions,
        } : {}),
      };
    },
  });
}

interface SearchProviderCandidate {
  explicit: boolean;
  provider: SearchProvider;
}

function createConfiguredSearchCandidates(
  options: WebBasicsOptions,
): SearchProviderCandidate[] {
  const backend = options.searchBackend ?? "searxng";
  if (backend === "auto") {
    const candidates: SearchProviderCandidate[] = [];
    if (options.braveApiKey?.trim()) {
      candidates.push({
        explicit: false,
        provider: createBraveSearchProvider(options.braveApiKey),
      });
    }
    if (options.searxngUrl?.trim()) {
      candidates.push({
        explicit: false,
        provider: createSearxngSearchProvider(options.searxngUrl),
      });
    }
    if (options.allowKeylessFallback) {
      candidates.push(
        { explicit: false, provider: createFirecrawlSearchProvider() },
        { explicit: false, provider: createExaSearchProvider() },
        { explicit: false, provider: createDuckDuckGoSearchProvider() },
      );
    }
    if (candidates.length === 0) {
      throw validationError(
        "Automatic search requires braveApiKey or searxngUrl unless allowKeylessFallback is enabled",
      );
    }
    return candidates;
  }
  if (backend === "brave") {
    return [{
      explicit: true,
      provider: createBraveSearchProvider(options.braveApiKey ?? ""),
    }];
  }
  if (backend === "searxng") {
    return [{
      explicit: true,
      provider: createSearxngSearchProvider(options.searxngUrl),
    }];
  }
  if (backend === "firecrawl") {
    return [{ explicit: true, provider: createFirecrawlSearchProvider() }];
  }
  if (backend === "exa") {
    return [{ explicit: true, provider: createExaSearchProvider() }];
  }
  if (backend === "duckduckgo") {
    return [{ explicit: true, provider: createDuckDuckGoSearchProvider() }];
  }
  throw validationError(`Unsupported search backend: ${String(backend)}`);
}

export async function webSearch(
  input: WebSearchInput,
  searchProvider: SearchProvider | readonly SearchProvider[] =
    createSearxngSearchProvider(),
): Promise<SearchResponse> {
  const providers = Array.isArray(searchProvider)
    ? searchProvider
    : [searchProvider as SearchProvider];
  return executeWebSearch(
    input,
    providers.map((provider) => ({
      explicit: !Array.isArray(searchProvider),
      provider,
    })),
  );
}

export class SearchChainError extends AggregateError {
  constructor(
    errors: readonly unknown[],
    message: string,
    public readonly provider: SearchProviderId | "none",
  ) {
    super(errors, message);
    this.name = "SearchChainError";
  }
}

async function executeWebSearch(
  input: WebSearchInput,
  candidates: readonly SearchProviderCandidate[],
): Promise<SearchResponse> {
  const query = normalizeQuery(input.query);
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  validateIntegerRange(limit, "limit", 1, MAX_SEARCH_LIMIT);
  if (input.numSearchResults !== undefined) {
    validateIntegerRange(
      input.numSearchResults,
      "numSearchResults",
      1,
      MAX_SEARCH_LIMIT,
    );
  }
  const sourceLimit = input.numSearchResults ?? limit;
  input.signal?.throwIfAborted();
  const params: SearchParams = {
    query,
    limit,
    recency: input.recency,
    maxOutputTokens: input.maxTokens,
    numSearchResults: input.numSearchResults,
    temperature: input.temperature,
    signal: input.signal,
  };
  const failures: Array<{ provider: SearchProvider; error: unknown }> = [];
  let availableProviderCount = 0;
  let lastProvider: SearchProvider | undefined;

  for (const candidate of candidates) {
    const { provider } = candidate;
    lastProvider = provider;
    try {
      const available = candidate.explicit
        ? await provider.isExplicitlyAvailable()
        : await provider.isAvailable();
      if (!available && !candidate.explicit) continue;
      if (!available) {
        throw new SearchProviderError(
          provider.id,
          `${provider.label} web search is unavailable. Configure its credentials or select the automatic provider chain.`,
        );
      }
      availableProviderCount += 1;
      const providerResponse = await provider.search(params);
      input.signal?.throwIfAborted();
      const response: SearchResponse = {
        ...providerResponse,
        provider: provider.id,
        sources: normalizeSearchSources(providerResponse.sources, sourceLimit),
      };
      if (!hasRenderableSearchContent(response)) {
        throw new SearchProviderError(
          provider.id,
          `${provider.label} returned no renderable search content.`,
          204,
        );
      }
      return response;
    } catch (error) {
      input.signal?.throwIfAborted();
      failures.push({ provider, error });
    }
  }

  if (availableProviderCount === 0 && failures.length === 0) {
    throw new SearchChainError([], "No web search provider configured.", "none");
  }

  const lastFailure = failures.at(-1);
  const unboundedMessage = failures.length > 1
    ? `All web search providers failed: ${failures
      .map(({ provider, error }) =>
        `${provider.id}: ${formatSearchProviderFailure(error, provider)}`)
      .join("; ")}`
    : lastFailure
      ? formatSearchProviderFailure(lastFailure.error, lastFailure.provider)
      : `Unknown error from ${lastProvider?.label ?? "web search provider"}`;
  const message = unboundedMessage.slice(0, MAX_SEARCH_CHAIN_ERROR_LENGTH);
  throw new SearchChainError(
    failures.map(({ error }) => error),
    message,
    lastFailure?.provider.id ?? lastProvider?.id ?? "none",
  );
}

function hasRenderableSearchContent(response: SearchResponse): boolean {
  if (response.answer?.trim()) return true;
  if (response.sources.length > 0) return true;
  if (response.citations?.length) return true;
  if (response.relatedQuestions?.some((question) => question.trim())) return true;
  if (response.searchQueries?.some((query) => query.trim())) return true;
  return false;
}

function dateToAgeSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
}

function formatSearxngAnswers(answers: unknown[] | undefined): string | undefined {
  const texts = (answers ?? [])
    .flatMap((answer) => {
      const text = extractSearxngAnswerText(answer);
      return text ? [text] : [];
    })
    .slice(0, 3);
  return texts.length ? texts.join("\n\n") : undefined;
}

function extractSearxngAnswerText(answer: unknown): string | undefined {
  if (typeof answer === "string") return answer.trim() || undefined;
  if (!answer || typeof answer !== "object") return undefined;
  const record = answer as Record<string, unknown>;
  if (typeof record.answer === "string") return record.answer.trim() || undefined;

  if (Array.isArray(record.translations)) {
    const translations = record.translations.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const text = (item as Record<string, unknown>).text;
      return typeof text === "string" && text.trim() ? [text.trim()] : [];
    }).slice(0, 3);
    if (translations.length) return translations.join("\n");
  }

  if (record.current && typeof record.current === "object") {
    const current = record.current as Record<string, unknown>;
    if (typeof current.summary === "string" && current.summary.trim()) {
      return current.summary.trim();
    }
    const location = current.location && typeof current.location === "object"
      ? (current.location as Record<string, unknown>).name
      : undefined;
    const temperature = current.temperature && typeof current.temperature === "object"
      ? current.temperature as Record<string, unknown>
      : undefined;
    const temperatureText = temperature &&
      (typeof temperature.val === "string" || typeof temperature.val === "number")
      ? `${temperature.val}${typeof temperature.unit === "string" ? temperature.unit : ""}`
      : undefined;
    const condition = typeof current.condition === "string"
      ? current.condition
      : undefined;
    const parts = [location, temperatureText, condition].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0,
    );
    if (parts.length) return parts.join(": ");
  }

  return undefined;
}

function formatSearchProviderFailure(
  error: unknown,
  provider: Pick<SearchProvider, "id" | "label">,
): string {
  if (error instanceof SearchProviderError) {
    if (error.status === 401 || error.status === 403) {
      return `${provider.label} authorization failed (${error.status}). Check API key or base URL.`;
    }
    return normalizeSearchProviderErrorMessage(error.message, provider.label);
  }
  return error instanceof Error
    ? normalizeSearchProviderErrorMessage(error.message, provider.label)
    : `Unknown error from ${provider.label}`;
}

function normalizeSearchProviderErrorMessage(
  message: string,
  providerLabel: string,
): string {
  return message.replace(/\s+/gu, " ").trim().slice(
    0,
    MAX_SEARCH_PROVIDER_ERROR_LENGTH,
  ) || `Unknown error from ${providerLabel}`;
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
