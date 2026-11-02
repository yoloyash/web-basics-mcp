import Parser from "rss-parser";
import { validationError } from "./errors.js";
import {
  fetchPublicHttpUrl,
  HttpStatusError,
  readBytesCapped,
  type FetchPublicHttpOptions,
} from "./http.js";

const FETCH_TIMEOUT_MS = 15000;
const MAX_REDDIT_RSS_BYTES = 5 * 1024 * 1024;
export const REDDIT_CACHE_TTL_MS = 60 * 60_000;
export const REDDIT_USER_AGENT =
  "web-basics/0.1 (+https://github.com/yoloyash/web-basics-mcp)";
const REDDIT_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "new.reddit.com",
  "np.reddit.com",
  "m.reddit.com",
]);
const REDDIT_SHORT_LINK_HOSTS = new Set(["redd.it", "www.redd.it"]);
const REDDIT_MARKDOWN_BLOCK = /<!--\s*SC_OFF\s*-->([\s\S]*?)<!--\s*SC_ON\s*-->/gu;
const REDDIT_LINK_ANCHOR = /<a\s+[^>]*href="([^"]+)"[^>]*>\s*\[link\]\s*<\/a>/iu;
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

type RedditFetchOptions = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "retryDelayMs" | "signal" | "wait"
>;

export interface RedditPostUrl {
  canonicalUrl: string;
  rssUrl: string;
  /** Empty when the URL does not name the subreddit (comment permalinks, redd.it links). */
  subreddit: string;
  postId: string;
  slug: string;
}

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  published: string;
  link: string;
  /** Reddit's rendered post body as HTML; empty for link posts without text. */
  contentHtml: string;
  /** Plain-text fallback for the body. */
  contentText: string;
  /** Outbound target of a link post, when it is not the post itself. */
  externalUrl?: string;
}

export interface RedditComment {
  id: string;
  author: string;
  published: string;
  link: string;
  contentHtml: string;
  contentText: string;
}

export interface RedditFetchResult {
  cacheable?: boolean;
  cacheTtlMs?: number;
  url: string;
  subreddit: string;
  post: RedditPost;
  comments: RedditComment[];
}

/**
 * Fetches a Reddit post and its top-level comments from Reddit's public Atom feed.
 *
 * The feed is the only route Reddit still serves to logged-out clients: old Reddit redirects
 * to a login page, and the `.json` endpoints return bot-block pages. Reddit throttles anonymous
 * feed requests to roughly one per minute per IP, so callers should cache results.
 */
export async function fetchRedditPost(url: string, options: RedditFetchOptions = {}): Promise<RedditFetchResult> {
  const postUrl = requireRedditPostUrl(url);

  let res: Response;
  try {
    ({ res } = await fetchPublicHttpUrl(postUrl.rssUrl, {
      ...options,
      headers: { Accept: "application/atom+xml, application/xml, text/xml, */*" },
      maxTransientRetries: 0,
      timeoutMs: FETCH_TIMEOUT_MS,
      userAgent: REDDIT_USER_AGENT,
    }));
  } catch (err) {
    throw describeRedditFetchError(err);
  }

  const xml = new TextDecoder("utf-8", { fatal: false }).decode(
    await readBytesCapped(res, MAX_REDDIT_RSS_BYTES, options.signal),
  );
  options.signal?.throwIfAborted();
  const feed = await new Parser().parseString(xml);
  options.signal?.throwIfAborted();
  if (!feed.items || feed.items.length === 0) {
    throw validationError("No items found in the Reddit feed. Make sure the URL is a valid Reddit post.");
  }

  const [postItem, ...commentItems] = feed.items;
  const postLink = parseRedditUrl(postItem.link ?? "");
  const resolvedUrl = postLink && postLink.postId.toLowerCase() === postUrl.postId.toLowerCase()
    ? postLink
    : postUrl;
  const postHtml = postItem.content ?? "";

  const post: RedditPost = {
    id: postItem.id || "",
    title: postItem.title || "",
    author: postItem.author || "",
    published: postItem.isoDate || "",
    link: postItem.link || resolvedUrl.canonicalUrl,
    contentHtml: extractMarkdownBlocks(postHtml),
    contentText: cleanContent(postItem.contentSnippet),
    externalUrl: extractExternalUrl(postHtml),
  };

  const comments: RedditComment[] = commentItems.map((item) => ({
    id: item.id || "",
    author: item.author || "",
    published: item.isoDate || "",
    link: item.link || "",
    contentHtml: extractMarkdownBlocks(item.content ?? "") || (item.content ?? ""),
    contentText: (item.contentSnippet || "").trim(),
  }));

  return {
    ...redditResponseCachePolicy(res),
    url: resolvedUrl.canonicalUrl,
    subreddit: resolvedUrl.subreddit || subredditFromFeedTitle(feed.title),
    post,
    comments,
  };
}

export function isRedditUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return REDDIT_HOSTS.has(hostname) || REDDIT_SHORT_LINK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export function redditPostCacheKey(rawUrl: string): string {
  return `reddit-post:${requireRedditPostUrl(rawUrl).postId.toLowerCase()}`;
}

export function redditResponseCachePolicy(res: Response): {
  cacheable: boolean;
  cacheTtlMs: number;
} {
  const directives = (res.headers.get("cache-control") ?? "")
    .toLowerCase()
    .split(",")
    .map((directive) => directive.trim());
  const cacheable = !directives.some(
    (directive) =>
      directive === "no-cache" ||
      directive === "no-store" ||
      /^max-age\s*=\s*0$/u.test(directive),
  );
  const maxAge = directives
    .map((directive) => directive.match(/^max-age\s*=\s*(\d+)$/u))
    .find((match) => match !== null);
  const upstreamTtlMs = maxAge ? Number(maxAge[1]) * 1000 : REDDIT_CACHE_TTL_MS;

  return {
    cacheable,
    cacheTtlMs: Math.min(upstreamTtlMs, REDDIT_CACHE_TTL_MS),
  };
}

export function requireRedditPostUrl(rawUrl: string): RedditPostUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw validationError("Invalid URL");
  }

  if (url.protocol !== "https:") {
    throw validationError("Only HTTPS Reddit URLs are supported");
  }
  if (!isRedditUrl(rawUrl)) {
    throw validationError("Only Reddit post URLs are supported");
  }
  if (url.username || url.password) {
    throw validationError("Credentials not allowed");
  }

  const postUrl = parseRedditPostPath(url.hostname.toLowerCase(), url.pathname);
  if (!postUrl) {
    throw validationError("URL must be a Reddit post URL like https://www.reddit.com/r/subreddit/comments/post_id/title/");
  }
  if (postUrl.subreddit && !/^[a-zA-Z0-9_]{2,21}$/.test(postUrl.subreddit)) {
    throw validationError("Invalid subreddit in URL");
  }
  if (!/^[a-zA-Z0-9]+$/.test(postUrl.postId)) {
    throw validationError("Invalid Reddit post ID in URL");
  }

  return postUrl;
}

/** Seconds until Reddit's anonymous feed throttle resets, from its rate-limit headers. */
export function redditRateLimitResetSeconds(headers: Headers): number | undefined {
  const reset = headers.get("x-ratelimit-reset")?.trim();
  if (reset && /^\d+(?:\.\d+)?$/u.test(reset)) return Math.ceil(Number(reset));
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter && /^\d+$/u.test(retryAfter)) return Number(retryAfter);
  return undefined;
}

function describeRedditFetchError(err: unknown): unknown {
  if (err instanceof HttpStatusError && err.status === 429) {
    const reset = redditRateLimitResetSeconds(err.headers);
    err.message =
      `${err.message}: Reddit throttles anonymous feed requests to about one per minute per IP` +
      (reset !== undefined ? `; retry after ${reset}s` : "");
  }
  return err;
}

function parseRedditUrl(rawUrl: string): RedditPostUrl | undefined {
  try {
    const url = new URL(rawUrl);
    if (!isRedditUrl(rawUrl)) return undefined;
    return parseRedditPostPath(url.hostname.toLowerCase(), url.pathname);
  } catch {
    return undefined;
  }
}

function parseRedditPostPath(hostname: string, pathname: string): RedditPostUrl | undefined {
  const parts = pathname.split("/").filter(Boolean).map(stripRssSuffix);

  if (REDDIT_SHORT_LINK_HOSTS.has(hostname)) {
    const [postId, ...rest] = parts;
    if (!postId || rest.length > 0) return undefined;
    return buildRedditPostUrl("", postId, "");
  }

  const commentsIndex = parts.findIndex((part) => part.toLowerCase() === "comments");
  if (commentsIndex === -1) return undefined;
  const postId = parts[commentsIndex + 1];
  if (!postId) return undefined;
  const slug = parts[commentsIndex + 2] ?? "";

  if (commentsIndex === 0) return buildRedditPostUrl("", postId, slug);
  if (commentsIndex === 2 && parts[0].toLowerCase() === "r") {
    return buildRedditPostUrl(parts[1], postId, slug);
  }
  return undefined;
}

function buildRedditPostUrl(subreddit: string, postId: string, slug: string): RedditPostUrl {
  const canonicalUrl = subreddit
    ? `https://www.reddit.com/r/${subreddit}/comments/${postId}/${slug ? `${slug}/` : ""}`
    : `https://www.reddit.com/comments/${postId}/`;
  return {
    canonicalUrl,
    rssUrl: `${canonicalUrl}.rss`,
    subreddit,
    postId,
    slug,
  };
}

function subredditFromFeedTitle(title: string | undefined): string {
  const suffix = title?.includes(":") ? title.split(":").pop()?.trim() ?? "" : "";
  return suffix && suffix.toLowerCase() !== "reddit.com" ? suffix : "";
}

function extractMarkdownBlocks(html: string): string {
  const blocks = [...html.matchAll(REDDIT_MARKDOWN_BLOCK)].map((match) => match[1].trim());
  return blocks.filter(Boolean).join("\n");
}

function extractExternalUrl(html: string): string | undefined {
  const href = html.match(REDDIT_LINK_ANCHOR)?.[1];
  if (!href) return undefined;
  const target = decodeHtmlEntities(href);
  return isRedditUrl(target) ? undefined : target;
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/gu, (entity) => HTML_ENTITIES[entity] ?? entity);
}

function cleanContent(text?: string): string {
  if (!text) return "";
  return text
    .replace(/\s*submitted by[\s\S]*$/i, "")
    .replace(/\s*\[link\]\s*\[comments\]\s*$/i, "")
    .trim();
}

function stripRssSuffix(value: string): string {
  return value.replace(/\.rss$/i, "");
}
