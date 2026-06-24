import Parser from "rss-parser";
import { normalizeQuery, searchSearxng } from "./search.js";
import { validationError } from "./errors.js";

const FETCH_TIMEOUT_MS = 15000;
const REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com"]);
const CACHE_TTL_MS = 60_000;
const MAX_POST_CHARS = 8000;
const MAX_COMMENT_CHARS = 2000;
const MAX_CACHE_ENTRIES = 100;

export const DEFAULT_COMMENT_LIMIT = 100;
export const MAX_COMMENT_LIMIT = 500;

const postCache = new Map<string, { expiresAt: number; result: RedditFetchResult }>();

interface RedditPostUrl {
  canonicalUrl: string;
  rssUrl: string;
  subreddit: string;
  postId: string;
  slug: string;
}

interface RedditPost {
  id: string;
  title: string;
  author: string;
  published: string;
  link: string;
  content: string;
}

interface RedditComment {
  id: string;
  author: string;
  published: string;
  link: string;
  content: string;
}

export interface RedditSearchResult {
  title: string;
  link: string;
  subreddit: string;
  post_id: string;
  slug: string;
  search_score: number | null;
  source_engines: string[];
  snippet: string;
}

export interface RedditFetchResult {
  url: string;
  subreddit: string;
  post: RedditPost;
  comments: RedditComment[];
  comments_returned: number;
  comments_available: number;
}

export async function searchRedditPosts(
  query: string,
  subreddit: string | undefined,
  limit: number,
): Promise<RedditSearchResult[]> {
  const normalizedQuery = normalizeQuery(query);
  const normalizedSubreddit = normalizeSubreddit(subreddit);
  const siteQuery = normalizedSubreddit
    ? `site:reddit.com/r/${normalizedSubreddit}/comments ${normalizedQuery}`
    : `site:reddit.com/r/ ${normalizedQuery}`;

  const seen = new Set<string>();
  const results = await searchSearxng(siteQuery);

  return results
    .flatMap((result) => {
      const postUrl = parseRedditPostUrl(result.url);
      if (!postUrl) return [];
      if (normalizedSubreddit && postUrl.subreddit.toLowerCase() !== normalizedSubreddit.toLowerCase()) return [];
      if (seen.has(postUrl.postId)) return [];
      seen.add(postUrl.postId);

      return [
        {
          title: cleanTitle(result.title) || postUrl.slug.replaceAll("_", " "),
          link: postUrl.canonicalUrl,
          subreddit: `r/${postUrl.subreddit}`,
          post_id: postUrl.postId,
          slug: postUrl.slug,
          search_score: result.score ?? null,
          source_engines: result.engines ?? [],
          snippet: result.content ?? "",
        },
      ];
    })
    .slice(0, limit);
}

export async function fetchRedditPost(url: string, commentsLimit: number): Promise<RedditFetchResult> {
  const postUrl = requireRedditPostUrl(url);
  pruneExpiredCache();

  const cached = postCache.get(postUrl.canonicalUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return withCommentLimit(cached.result, commentsLimit);
  }

  const parser = new Parser({
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 mcp-web-basics/1.0",
      Accept: "application/atom+xml, application/xml, text/xml, */*",
    },
    timeout: FETCH_TIMEOUT_MS,
  });

  const feed = await parser.parseURL(postUrl.rssUrl);
  if (!feed.items || feed.items.length === 0) {
    throw validationError("No items found in the RSS feed. Make sure the URL is a valid Reddit post.");
  }

  const postItem = feed.items[0];
  const commentItems = feed.items.slice(1);
  const subreddit = feed.title?.includes(":") ? feed.title.split(":").pop()?.trim() || "" : "";

  const post: RedditPost = {
    id: postItem.id || "",
    title: postItem.title || "",
    author: postItem.author || "",
    published: postItem.isoDate || "",
    link: postItem.link || "",
    content: cleanContent(postItem.contentSnippet).slice(0, MAX_POST_CHARS),
  };

  const comments: RedditComment[] = commentItems.map((item) => ({
    id: item.id || "",
    author: item.author || "",
    published: item.isoDate || "",
    link: item.link || "",
    content: (item.contentSnippet || "").trim().slice(0, MAX_COMMENT_CHARS),
  }));

  const result = {
    url: postUrl.canonicalUrl,
    subreddit: subreddit || postUrl.subreddit,
    post,
    comments,
    comments_returned: comments.length,
    comments_available: comments.length,
  };

  postCache.set(postUrl.canonicalUrl, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  trimCache();
  return withCommentLimit(result, commentsLimit);
}

function normalizeSubreddit(input?: string): string | undefined {
  if (!input) return undefined;

  const name = input.trim().replace(/^\/?r\//i, "");
  if (!name) return undefined;
  if (!/^[a-zA-Z0-9_]{2,21}$/.test(name)) {
    throw validationError("Invalid subreddit. Use a subreddit name like typescript or r/typescript.");
  }

  return name;
}

function parseRedditPostUrl(rawUrl: string): RedditPostUrl | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }

  if (!REDDIT_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  return parseRedditPostPath(url.pathname);
}

function requireRedditPostUrl(rawUrl: string): RedditPostUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw validationError("Invalid URL");
  }

  if (url.protocol !== "https:") {
    throw validationError("Only HTTPS Reddit URLs are supported");
  }
  if (!REDDIT_HOSTS.has(url.hostname.toLowerCase())) {
    throw validationError("Only Reddit post URLs are supported");
  }
  if (url.username || url.password) {
    throw validationError("Credentials not allowed");
  }

  const postUrl = parseRedditPostPath(url.pathname);
  if (!postUrl) {
    throw validationError("URL must be a Reddit post URL like https://www.reddit.com/r/subreddit/comments/post_id/title/");
  }
  if (!/^[a-zA-Z0-9_]{2,21}$/.test(postUrl.subreddit)) {
    throw validationError("Invalid subreddit in URL");
  }
  if (!/^[a-zA-Z0-9]+$/.test(postUrl.postId)) {
    throw validationError("Invalid Reddit post ID in URL");
  }

  return postUrl;
}

function parseRedditPostPath(pathname: string): RedditPostUrl | undefined {
  const parts = pathname.split("/").filter(Boolean);
  const rIndex = parts.findIndex((part) => part.toLowerCase() === "r");
  if (rIndex === -1) return undefined;

  const subreddit = parts[rIndex + 1];
  const commentsSegment = parts[rIndex + 2];
  const postId = stripRssSuffix(parts[rIndex + 3] ?? "");
  const slug = stripRssSuffix(parts[rIndex + 4] ?? "");
  if (!subreddit || commentsSegment?.toLowerCase() !== "comments" || !postId) return undefined;

  const canonicalUrl = `https://www.reddit.com/r/${subreddit}/comments/${postId}/${slug ? `${slug}/` : ""}`;
  return {
    canonicalUrl,
    rssUrl: `${canonicalUrl}.rss`,
    subreddit,
    postId,
    slug,
  };
}

function cleanTitle(title?: string): string {
  return (title ?? "").replace(/\s+-\s+Reddit$/i, "").trim();
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

function withCommentLimit(result: RedditFetchResult, commentsLimit: number): RedditFetchResult {
  const comments = result.comments.slice(0, commentsLimit);
  return {
    ...result,
    comments,
    comments_returned: comments.length,
    comments_available: result.comments_available,
  };
}

function pruneExpiredCache(): void {
  const now = Date.now();
  for (const [key, value] of postCache) {
    if (value.expiresAt <= now) postCache.delete(key);
  }
}

function trimCache(): void {
  while (postCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = postCache.keys().next().value;
    if (!oldestKey) return;
    postCache.delete(oldestKey);
  }
}
