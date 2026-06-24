import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Parser from "rss-parser";
import { classifyError, validationError } from "./errors.js";

const FETCH_TIMEOUT_MS = 15000;
const REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com"]);
const CACHE_TTL_MS = 60_000;
const DEFAULT_COMMENT_LIMIT = 100;
const MAX_COMMENT_LIMIT = 500;
const MAX_POST_CHARS = 8000;
const MAX_COMMENT_CHARS = 2000;
const MAX_CACHE_ENTRIES = 100;

const postCache = new Map<string, { expiresAt: number; result: RedditFetchResult }>();

export default function registerRedditFetch(server: McpServer) {
  server.registerTool(
    "reddit_fetch",
    {
      description: "Fetch a Reddit post and comments from its RSS feed. Returns bounded structured JSON.",
      inputSchema: {
        url: z.string().url().describe("Reddit post URL (e.g., https://www.reddit.com/r/subreddit/comments/...)"),
        comments_limit: z
          .number()
          .int()
          .min(0)
          .max(MAX_COMMENT_LIMIT)
          .default(DEFAULT_COMMENT_LIMIT)
          .describe(`Maximum comments to return (max ${MAX_COMMENT_LIMIT})`),
      },
    },
    async ({ url, comments_limit }) => {
      try {
        const result = await fetchRedditPost(url, comments_limit);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}

interface RedditPostUrl {
  canonicalUrl: string;
  rssUrl: string;
  subreddit: string;
}

function parseRedditPostUrl(rawUrl: string): RedditPostUrl {
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

  const parts = url.pathname.split("/").filter(Boolean);
  const rIndex = parts.findIndex((part) => part.toLowerCase() === "r");
  const subreddit = parts[rIndex + 1];
  const commentsSegment = parts[rIndex + 2];
  const postId = stripRssSuffix(parts[rIndex + 3] ?? "");
  const slug = stripRssSuffix(parts[rIndex + 4] ?? "");

  if (rIndex === -1 || !subreddit || commentsSegment?.toLowerCase() !== "comments" || !postId) {
    throw validationError("URL must be a Reddit post URL like https://www.reddit.com/r/subreddit/comments/post_id/title/");
  }
  if (!/^[a-zA-Z0-9_]{2,21}$/.test(subreddit)) {
    throw validationError("Invalid subreddit in URL");
  }
  if (!/^[a-zA-Z0-9]+$/.test(postId)) {
    throw validationError("Invalid Reddit post ID in URL");
  }

  const canonicalUrl = `https://www.reddit.com/r/${subreddit}/comments/${postId}/${slug ? `${slug}/` : ""}`;

  return {
    canonicalUrl,
    rssUrl: `${canonicalUrl}.rss`,
    subreddit,
  };
}

function cleanContent(text?: string): string {
  if (!text) return "";
  return text
    .replace(/\s*submitted by[\s\S]*$/i, "")
    .replace(/\s*\[link\]\s*\[comments\]\s*$/i, "")
    .trim();
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

interface RedditFetchResult {
  url: string;
  subreddit: string;
  post: RedditPost;
  comments: RedditComment[];
  comments_returned: number;
  comments_available: number;
}

async function fetchRedditPost(url: string, commentsLimit: number): Promise<RedditFetchResult> {
  const postUrl = parseRedditPostUrl(url);
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
