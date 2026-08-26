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

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 10_000;
const RECENCY_TBS = {
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
} as const;

type FirecrawlDependencies = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "wait"
>;

interface FirecrawlWebResult {
  description?: string | null;
  markdown?: string | null;
  snippet?: string | null;
  title?: string | null;
  url?: string | null;
}

export function createFirecrawlSearchProvider(
  dependencies: FirecrawlDependencies = {},
): SearchProvider {
  return coalesceSearchProvider(createSearchProvider({
    id: "firecrawl",
    label: "Firecrawl",
    async search(params) {
      const limit = normalizeSearchProviderLimit(
        params.numSearchResults ?? params.limit,
      );
      const body: Record<string, unknown> = {
        limit,
        query: params.query,
        sources: [{ type: "web" }],
      };
      if (params.recency) body.tbs = RECENCY_TBS[params.recency];
      const { res } = await fetchPublicHttpUrl(FIRECRAWL_SEARCH_URL, {
        ...dependencies,
        body: JSON.stringify(body),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        maxRedirects: 0,
        maxTransientRetries: 0,
        method: "POST",
        signal: params.signal,
        timeoutMs: SEARCH_TIMEOUT_MS,
      });

      const payload = parseJsonResponse(
        res,
        await readBytesCapped(res, MAX_RESPONSE_BYTES, params.signal),
        "Firecrawl",
      );
      if (!isRecord(payload)) throw new Error("Failed to parse Firecrawl response");
      if (payload.success === false) {
        throw new Error(
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error
            : "Firecrawl search failed",
        );
      }

      const requestId = typeof payload.id === "string" && payload.id.trim()
        ? payload.id
        : undefined;
      return {
        sources: normalizeSearchSources(firecrawlResults(payload), limit),
        authMode: "keyless",
        ...(requestId ? { requestId } : {}),
      };
    },
  }));
}

function firecrawlResults(payload: Record<string, unknown>): SearchSourceCandidate[] {
  const data = payload.data;
  let values: unknown[] = [];
  if (Array.isArray(data)) values = data;
  if (isRecord(data) && Array.isArray(data.web)) values = data.web;
  if (values.length === 0 && Array.isArray(payload.results)) values = payload.results;

  return values.filter(isFirecrawlWebResult).flatMap((result) => {
    if (typeof result.url !== "string") return [];
    return [{
      url: result.url,
      title: result.title,
      snippet: result.description ?? result.snippet ?? result.markdown,
    }];
  });
}

function isFirecrawlWebResult(value: unknown): value is FirecrawlWebResult {
  return isRecord(value) &&
    (value.url === undefined || value.url === null || typeof value.url === "string") &&
    (value.title === undefined || value.title === null || typeof value.title === "string") &&
    (value.description === undefined || value.description === null || typeof value.description === "string") &&
    (value.snippet === undefined || value.snippet === null || typeof value.snippet === "string") &&
    (value.markdown === undefined || value.markdown === null || typeof value.markdown === "string");
}

function parseJsonResponse(res: Response, bytes: Uint8Array, provider: string): unknown {
  const contentType = res.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new Error(`Unsupported content-type from ${provider}: ${contentType ?? "unknown"}`);
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`Failed to parse ${provider} response`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
