import { validationError } from "./errors.js";
import {
  fetchPublicHttpUrl,
  readBytesCapped,
  type FetchPublicHttpOptions,
} from "./http.js";
import type { NormalizedQuery } from "./search.js";
import {
  coalesceSearchProvider,
  createSearchProvider,
  normalizeSearchProviderLimit,
  normalizeSearchSources,
  type SearchProvider,
  type SearchSourceCandidate,
} from "./search-provider.js";
import type { SearchResponse } from "./search-types.js";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_API_VERSION = "2023-01-01";
const BRAVE_MAX_QUERY_LENGTH = 400;
const BRAVE_MAX_QUERY_WORDS = 50;
const BRAVE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const BRAVE_RETRY_DELAY_MS = 1_000;
const BRAVE_MAX_RETRY_DELAY_MS = 2_000;
const BRAVE_TIMEOUT_MS = 10_000;
const RECENCY_MAP = {
  day: "pd",
  week: "pw",
  month: "pm",
  year: "py",
} as const;

type BraveSearchDependencies = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "wait"
>;

interface BraveWebResult {
  description?: string;
  title?: string;
  url: string;
}

export function createBraveSearchProvider(apiKey: string): SearchProvider;
export function createBraveSearchProvider(
  apiKey: string,
  dependencies: BraveSearchDependencies = {},
): SearchProvider {
  const subscriptionToken = apiKey.trim();
  validateApiKey(subscriptionToken);

  return coalesceSearchProvider(createSearchProvider({
    id: "brave",
    label: "Brave",
    isAvailable: () => subscriptionToken.length > 0,
    async search(params) {
      validateBraveQuery(params.query);
      const requestedLimit = normalizeSearchProviderLimit(
        params.numSearchResults ?? params.limit,
      );
      return searchBrave(
        params.query as NormalizedQuery,
        subscriptionToken,
        requestedLimit,
        params.signal ?? new AbortController().signal,
        params.recency,
        dependencies,
      );
    },
  }));
}

async function searchBrave(
  query: NormalizedQuery,
  apiKey: string,
  limit: number,
  signal: AbortSignal,
  recency: "day" | "week" | "month" | "year" | undefined,
  dependencies: BraveSearchDependencies,
): Promise<Omit<SearchResponse, "provider">> {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("result_filter", "web");
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("text_decorations", "false");
  if (recency) url.searchParams.set("freshness", RECENCY_MAP[recency]);

  const { res } = await fetchPublicHttpUrl(url.toString(), {
    ...dependencies,
    headers: {
      Accept: "application/json",
      "Api-Version": BRAVE_API_VERSION,
      "X-Subscription-Token": apiKey,
    },
    maxRedirects: 0,
    maxTransientRetries: 1,
    retryDelayForResponse: braveRetryDelayMs,
    retryDelayMs: BRAVE_RETRY_DELAY_MS,
    signal,
    timeoutMs: BRAVE_TIMEOUT_MS,
  });

  const contentType = res.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new Error(`Unsupported content-type: ${contentType ?? "unknown"}`);
  }

  const bytes = await readBytesCapped(res, BRAVE_MAX_RESPONSE_BYTES, signal);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Failed to parse Brave Search response");
  }

  const requestId =
    res.headers.get("x-request-id") ??
    res.headers.get("request-id") ??
    undefined;
  return {
    sources: normalizeSearchSources(parseBraveResults(payload), limit),
    authMode: "api_key",
    ...(requestId ? { requestId } : {}),
  };
}

function braveRetryDelayMs(response: Response): number {
  if (response.status !== 429) return BRAVE_RETRY_DELAY_MS;

  const resetSeconds = response.headers
    .get("x-ratelimit-reset")
    ?.split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  const shortestReset = resetSeconds?.length ? Math.min(...resetSeconds) : undefined;
  if (shortestReset === undefined) return BRAVE_RETRY_DELAY_MS;

  return Math.min(
    Math.max(Math.ceil(shortestReset * 1_000), BRAVE_RETRY_DELAY_MS),
    BRAVE_MAX_RETRY_DELAY_MS,
  );
}

function parseBraveResults(payload: unknown): SearchSourceCandidate[] {
  if (!isRecord(payload)) throw new Error("Failed to parse Brave Search response");
  if (payload.web === undefined || payload.web === null) return [];
  if (!isRecord(payload.web)) throw new Error("Failed to parse Brave Search response");
  if (payload.web.results === undefined || payload.web.results === null) return [];
  if (!Array.isArray(payload.web.results)) {
    throw new Error("Failed to parse Brave Search response");
  }

  return payload.web.results
    .filter(isBraveWebResult)
    .map((result) => ({
      url: result.url,
      title: result.title ?? result.url,
      snippet: result.description,
    }));
}

function isBraveWebResult(value: unknown): value is BraveWebResult {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    (value.title === undefined || typeof value.title === "string") &&
    (value.description === undefined || typeof value.description === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateApiKey(apiKey: string): void {
  if (!apiKey.trim()) throw validationError("braveApiKey is required for Brave Search");
}

function validateBraveQuery(query: string): void {
  if (query.length > BRAVE_MAX_QUERY_LENGTH) {
    throw validationError(`Brave Search queries cannot exceed ${BRAVE_MAX_QUERY_LENGTH} characters`);
  }
  if (query.split(/\s+/u).length > BRAVE_MAX_QUERY_WORDS) {
    throw validationError(`Brave Search queries cannot exceed ${BRAVE_MAX_QUERY_WORDS} words`);
  }
}
