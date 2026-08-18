import Parser from "rss-parser";
import { validationError } from "./errors.js";
import { fetchPublicHttpUrl, readBytesCapped, type FetchPublicHttpOptions } from "./http.js";

const FETCH_TIMEOUT_MS = 15000;
const MAX_REDDIT_RSS_BYTES = 5 * 1024 * 1024;
const REDDIT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 mcp-web-basics/1.0";
const REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com"]);

type RedditFetchOptions = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "retryDelayMs" | "wait"
>;

interface RedditPostUrl {
  canonicalUrl: string;
  rssUrl: string;
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
  content: string;
}

export interface RedditComment {
  id: string;
  author: string;
  published: string;
  link: string;
  content: string;
}

export interface RedditFetchResult {
  url: string;
  subreddit: string;
  post: RedditPost;
  comments: RedditComment[];
}

export async function fetchRedditPost(url: string, options: RedditFetchOptions = {}): Promise<RedditFetchResult> {
  const postUrl = requireRedditPostUrl(url);

  const parser = new Parser();

  const { res } = await fetchPublicHttpUrl(postUrl.rssUrl, {
    ...options,
    headers: { Accept: "application/atom+xml, application/xml, text/xml, */*" },
    maxTransientRetries: 0,
    timeoutMs: FETCH_TIMEOUT_MS,
    userAgent: REDDIT_USER_AGENT,
  });

  const xml = new TextDecoder("utf-8", { fatal: false }).decode(await readBytesCapped(res, MAX_REDDIT_RSS_BYTES));
  const feed = await parser.parseString(xml);
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
    content: cleanContent(postItem.contentSnippet),
  };

  const comments: RedditComment[] = commentItems.map((item) => ({
    id: item.id || "",
    author: item.author || "",
    published: item.isoDate || "",
    link: item.link || "",
    content: (item.contentSnippet || "").trim(),
  }));

  return {
    url: postUrl.canonicalUrl,
    subreddit: subreddit || postUrl.subreddit,
    post,
    comments,
  };
}

export function isRedditUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return REDDIT_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
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
