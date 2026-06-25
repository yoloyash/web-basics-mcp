import { extractFetchedContent, fetchByteLimitForContentType } from "../content/index.js";
import { classifyError, validationError } from "./errors.js";
import { fetchPublicHttpUrl, readBytesCapped } from "./http.js";
import { normalizeQuery, searchSearxng, type SearxResult } from "./search.js";

const MAX_SOURCE_CONTENT_CHARS = 4000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_PDF_FETCH_BYTES = 15 * 1024 * 1024;

export const DEFAULT_RESEARCH_LIMIT = 3;
export const MAX_RESEARCH_LIMIT = 5;

type FetchUrl = typeof fetchPublicHttpUrl;
type ReadBytes = typeof readBytesCapped;
type ExtractContent = typeof extractFetchedContent;
type Search = typeof searchSearxng;

export interface ResearchQueryOptions {
  limit?: number;
  search?: Search;
  fetchUrl?: FetchUrl;
  readBytes?: ReadBytes;
  extractContent?: ExtractContent;
}

export interface ResearchSource {
  link: string;
  title: string;
  snippet: string;
  search_score: number | null;
  source_engines: string[];
  fetched: boolean;
  final_url?: string;
  content?: string;
  word_count?: number;
  content_type?: string;
  truncated?: boolean;
  extractor?: string;
  page_count?: number;
  metadata?: unknown;
  links?: unknown;
  error?: {
    category: string;
    message: string;
  };
}

export interface ResearchQueryResult {
  query: string;
  results: ResearchSource[];
  fetched_count: number;
  failed_count: number;
}

export async function researchQuery(query: string, options: ResearchQueryOptions = {}): Promise<ResearchQueryResult> {
  const normalizedQuery = normalizeQuery(query);
  const limit = normalizeResearchLimit(options.limit);
  const search = options.search ?? searchSearxng;
  const results = (await search(normalizedQuery)).slice(0, limit);
  const sources: ResearchSource[] = [];

  for (const result of results) {
    sources.push(await fetchResearchSource(result, options));
  }

  return {
    query: normalizedQuery,
    results: sources,
    fetched_count: sources.filter((source) => source.fetched).length,
    failed_count: sources.filter((source) => !source.fetched).length,
  };
}

function normalizeResearchLimit(input: number | undefined): number {
  const limit = input ?? DEFAULT_RESEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESEARCH_LIMIT) {
    throw validationError(`Limit must be an integer between 1 and ${MAX_RESEARCH_LIMIT}`);
  }
  return limit;
}

async function fetchResearchSource(
  result: SearxResult,
  options: ResearchQueryOptions,
): Promise<ResearchSource> {
  const source: ResearchSource = {
    link: result.url,
    title: result.title ?? result.url,
    snippet: result.content ?? "",
    search_score: result.score ?? null,
    source_engines: result.engines ?? [],
    fetched: false,
  };

  try {
    const fetchUrl = options.fetchUrl ?? fetchPublicHttpUrl;
    const readBytes = options.readBytes ?? readBytesCapped;
    const extractContent = options.extractContent ?? extractFetchedContent;
    const { res, finalUrl } = await fetchUrl(result.url);
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);

    const contentType = res.headers.get("content-type");
    const body = await readBytes(res, fetchByteLimitForContentType(contentType, MAX_FETCH_BYTES, MAX_PDF_FETCH_BYTES));
    const extracted = await extractContent(body, finalUrl, contentType);
    const content = extracted.content.slice(0, MAX_SOURCE_CONTENT_CHARS);

    source.fetched = true;
    source.final_url = finalUrl;
    source.content = content;
    source.word_count = extracted.wordCount;
    source.content_type = extracted.contentType;
    source.truncated = extracted.content.length > MAX_SOURCE_CONTENT_CHARS;
    source.extractor = extracted.extractor;

    if ("pageCount" in extracted) {
      source.page_count = extracted.pageCount;
      source.metadata = extracted.metadata;
      source.links = extracted.links;
    }
  } catch (err) {
    const { category, message } = classifyError(err);
    source.error = { category, message };
  }

  return source;
}
