import { validationError } from "./errors.js";

const FETCH_TIMEOUT_MS = 10000;
const MAX_QUERY_LENGTH = 500;

export interface SearxResult {
  url: string;
  title?: string;
  content?: string;
  score?: number;
  engines?: string[];
}

export async function searchSearxng(query: string): Promise<SearxResult[]> {
  const url = createSearchUrl();
  url.searchParams.set("q", normalizeQuery(query));
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "1");
  url.searchParams.set("language", "all");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP status ${res.status} from SearXNG`);

  const json = (await res.json()) as { results?: SearxResult[] };
  return json.results ?? [];
}

export function normalizeQuery(input: string): string {
  const query = input.trim();
  if (!query) throw validationError("Query cannot be empty");
  if (query.length > MAX_QUERY_LENGTH) throw validationError(`Query cannot exceed ${MAX_QUERY_LENGTH} characters`);
  return query;
}

function createSearchUrl(): URL {
  try {
    return new URL("/search", process.env.SEARXNG_URL ?? "http://127.0.0.1:8088");
  } catch {
    throw validationError("SEARXNG_URL must be a valid URL");
  }
}
