export const SEARCH_PROVIDER_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "brave", label: "Brave" },
  { value: "searxng", label: "SearXNG" },
  { value: "firecrawl", label: "Firecrawl" },
  { value: "exa", label: "Exa" },
  { value: "duckduckgo", label: "DuckDuckGo" },
] as const;

export type SearchProviderId = Exclude<
  (typeof SEARCH_PROVIDER_OPTIONS)[number]["value"],
  "auto"
>;

export type SearchProviderPreference = SearchProviderId | "auto";

export const SEARCH_PROVIDER_ORDER: readonly SearchProviderId[] =
  SEARCH_PROVIDER_OPTIONS.flatMap((option) =>
    option.value === "auto" ? [] : [option.value],
  );

export const SEARCH_PROVIDER_LABELS = Object.fromEntries(
  SEARCH_PROVIDER_OPTIONS.flatMap((option) =>
    option.value === "auto" ? [] : [[option.value, option.label] as const],
  ),
) as Record<SearchProviderId, string>;

export interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
  ageSeconds?: number;
  author?: string;
}

export interface SearchCitation {
  url: string;
  title: string;
  citedText?: string;
}

export interface SearchUsage {
  inputTokens?: number;
  outputTokens?: number;
  searchRequests?: number;
  totalTokens?: number;
}

export interface SearchResponse {
  provider: SearchProviderId | "none";
  answer?: string;
  sources: SearchSource[];
  citations?: SearchCitation[];
  searchQueries?: string[];
  relatedQuestions?: string[];
  usage?: SearchUsage;
  model?: string;
  requestId?: string;
  authMode?: string;
}

export class SearchProviderError extends Error {
  constructor(
    public readonly provider: SearchProviderId,
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SearchProviderError";
  }
}

