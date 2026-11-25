import {
  fetchPublicHttpUrl,
  readBytesCapped,
  type FetchPublicHttpOptions,
} from "./http.js";
import {
  coalesceSearchProvider,
  createSearchProvider,
  normalizeSearchProviderLimit,
  normalizeSearchSources,
  type SearchProvider,
  type SearchSourceCandidate,
} from "./search-provider.js";
import type { SearchResponse } from "./search-types.js";

const KEENABLE_SEARCH_URL = "https://api.keenable.ai/v1/search";
const KEENABLE_PUBLIC_SEARCH_URL = "https://api.keenable.ai/v1/search/public";
const DEFAULT_CLIENT_TITLE = "web-basics";
const KEENABLE_MAX_TITLE_LENGTH = 256;
const KEENABLE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const KEENABLE_RETRY_DELAY_MS = 1_000;
const KEENABLE_MAX_RETRY_DELAY_MS = 2_000;
const KEENABLE_TIMEOUT_MS = 10_000;
const RECENCY_MAP = {
  day: "1d",
  week: "7d",
  month: "1mo",
  year: "1y",
} as const;

export interface KeenableSearchOptions {
  apiKey?: string;
  clientTitle?: string;
}

type KeenableSearchDependencies = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "wait"
>;

interface KeenableSearchResult {
  description?: string | null;
  published_at?: string | null;
  snippet?: string | null;
  title?: string | null;
  url?: string | null;
}

export function createKeenableSearchProvider(
  options: KeenableSearchOptions = {},
  dependencies: KeenableSearchDependencies = {},
): SearchProvider {
  const apiKey = options.apiKey?.trim() ?? "";
  const clientTitle = normalizeClientTitle(options.clientTitle);

  return coalesceSearchProvider(createSearchProvider({
    id: "keenable",
    label: "Keenable",
    async search(params) {
      const requestedLimit = normalizeSearchProviderLimit(
        params.numSearchResults ?? params.limit,
      );
      return searchKeenable(
        params.query,
        apiKey,
        clientTitle,
        requestedLimit,
        params.signal ?? new AbortController().signal,
        params.recency,
        dependencies,
      );
    },
  }));
}

async function searchKeenable(
  query: string,
  apiKey: string,
  clientTitle: string,
  limit: number,
  signal: AbortSignal,
  recency: "day" | "week" | "month" | "year" | undefined,
  dependencies: KeenableSearchDependencies,
): Promise<Omit<SearchResponse, "provider">> {
  const endpoint = apiKey ? KEENABLE_SEARCH_URL : KEENABLE_PUBLIC_SEARCH_URL;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(apiKey
      ? { "X-API-Key": apiKey }
      : { "X-Keenable-Title": clientTitle }),
  };
  const body: Record<string, unknown> = {
    max_results: limit,
    query,
  };
  if (recency) body.published_after = RECENCY_MAP[recency];

  const { res } = await fetchPublicHttpUrl(endpoint, {
    ...dependencies,
    body: JSON.stringify(body),
    headers,
    maxRedirects: 0,
    maxTransientRetries: 1,
    method: "POST",
    retryDelayForResponse: keenableRetryDelayMs,
    retryDelayMs: KEENABLE_RETRY_DELAY_MS,
    signal,
    timeoutMs: KEENABLE_TIMEOUT_MS,
  });

  const contentType = res.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new Error(`Unsupported content-type from Keenable: ${contentType ?? "unknown"}`);
  }

  const bytes = await readBytesCapped(res, KEENABLE_MAX_RESPONSE_BYTES, signal);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Failed to parse Keenable Search response");
  }

  const requestId = res.headers.get("x-request-id")?.trim() || undefined;
  return {
    sources: normalizeSearchSources(parseKeenableResults(payload), limit),
    authMode: apiKey ? "api_key" : "keyless",
    ...(requestId ? { requestId } : {}),
  };
}

function keenableRetryDelayMs(response: Response): number {
  if (response.status !== 429) return KEENABLE_RETRY_DELAY_MS;

  const retryAfter = response.headers.get("retry-after")?.trim();
  if (!retryAfter || !/^\d+$/u.test(retryAfter)) return KEENABLE_RETRY_DELAY_MS;

  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return KEENABLE_RETRY_DELAY_MS;
  return Math.min(
    Math.max(seconds * 1_000, KEENABLE_RETRY_DELAY_MS),
    KEENABLE_MAX_RETRY_DELAY_MS,
  );
}

function parseKeenableResults(payload: unknown): SearchSourceCandidate[] {
  if (!isRecord(payload)) throw new Error("Failed to parse Keenable Search response");
  if (payload.results === undefined || payload.results === null) return [];
  if (!Array.isArray(payload.results)) {
    throw new Error("Failed to parse Keenable Search response");
  }

  return payload.results
    .filter(isKeenableResult)
    .flatMap((result) => {
      if (typeof result.url !== "string") return [];
      return [{
        url: result.url,
        title: result.title,
        snippet: firstString(result.snippet, result.description),
        publishedDate: typeof result.published_at === "string"
          ? result.published_at
          : undefined,
      }];
    });
}

function isKeenableResult(value: unknown): value is KeenableSearchResult {
  return (
    isRecord(value) &&
    (value.url === undefined || value.url === null || typeof value.url === "string") &&
    (value.title === undefined || value.title === null || typeof value.title === "string") &&
    (value.snippet === undefined || value.snippet === null || typeof value.snippet === "string") &&
    (value.description === undefined || value.description === null || typeof value.description === "string") &&
    (value.published_at === undefined || value.published_at === null || typeof value.published_at === "string")
  );
}

function normalizeClientTitle(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_CLIENT_TITLE;
  return trimmed.slice(0, KEENABLE_MAX_TITLE_LENGTH);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && !!value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
