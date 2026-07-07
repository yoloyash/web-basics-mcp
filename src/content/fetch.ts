import {
  extractFetchedContent,
  fetchByteLimitForContentType,
  type ExtractedContent,
} from "./index.js";
import { fetchRedditContent } from "./reddit.js";
import { isRedditUrl } from "../lib/reddit.js";
import { fetchPublicHttpUrl, readBytesCapped } from "../lib/http.js";

const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_PDF_FETCH_BYTES = 15 * 1024 * 1024;

export interface FetchedUrlContent {
  finalUrl: string;
  result: ExtractedContent;
}

export function recommendedFetchConcurrency(urls: string[], defaultConcurrency: number): number {
  return urls.some(isRedditUrl) ? 1 : defaultConcurrency;
}

export async function fetchUrlContent(url: string): Promise<FetchedUrlContent> {
  if (isRedditUrl(url)) {
    return fetchRedditContent(url);
  }

  const { res, finalUrl } = await fetchPublicHttpUrl(url);
  const responseContentType = res.headers.get("content-type");
  const body = await readBytesCapped(
    res,
    fetchByteLimitForContentType(responseContentType, MAX_FETCH_BYTES, MAX_PDF_FETCH_BYTES),
  );

  return { finalUrl, result: await extractFetchedContent(body, finalUrl, responseContentType) };
}
