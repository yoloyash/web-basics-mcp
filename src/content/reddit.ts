import { extractHtmlMarkdown, type HtmlCandidate } from "./html.js";
import {
  fetchRedditPost,
  redditResponseCachePolicy,
  REDDIT_USER_AGENT,
  requireRedditPostUrl,
  type RedditComment,
  type RedditFetchResult,
} from "../lib/reddit.js";
import {
  fetchPublicHttpUrl,
  readBytesCapped,
  type FetchPublicHttpOptions,
} from "../lib/http.js";

const FETCH_TIMEOUT_MS = 15000;
const MAX_REDDIT_HTML_BYTES = 5 * 1024 * 1024;

type RedditContentOptions = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "retryDelayMs" | "signal" | "wait"
> & {
  extractHtml?: (
    html: string,
    finalUrl: string,
  ) => Promise<HtmlCandidate & { fallbackReason?: string }>;
};

export interface RedditMarkdown {
  title: string;
  content: string;
  wordCount: number;
  extractor: "reddit";
  fallbackReason?: string;
}

export async function fetchRedditContent(
  url: string,
  options: RedditContentOptions = {},
): Promise<{
  cacheable?: boolean;
  cacheTtlMs?: number;
  finalUrl: string;
  result: RedditMarkdown & { contentType: string };
}> {
  const postUrl = requireRedditPostUrl(url);

  try {
    const { res, finalUrl } = await fetchPublicHttpUrl(postUrl.oldRedditUrl, {
      ...options,
      headers: { Accept: "text/html, application/xhtml+xml" },
      maxTransientRetries: 0,
      timeoutMs: FETCH_TIMEOUT_MS,
      userAgent: REDDIT_USER_AGENT,
    });
    const html = new TextDecoder("utf-8", { fatal: false }).decode(
      await readBytesCapped(res, MAX_REDDIT_HTML_BYTES, options.signal),
    );
    options.signal?.throwIfAborted();
    const extracted = await (options.extractHtml ?? extractHtmlMarkdown)(html, finalUrl);
    options.signal?.throwIfAborted();

    return {
      ...redditResponseCachePolicy(res),
      finalUrl: postUrl.canonicalUrl,
      result: {
        title: extracted.title,
        content: extracted.content,
        wordCount: extracted.wordCount,
        contentType: res.headers.get("content-type")?.split(";")[0]?.trim() || "text/html",
        extractor: "reddit",
        fallbackReason: extracted.fallbackReason,
      },
    };
  } catch {
    options.signal?.throwIfAborted();
  }

  const redditPost = await fetchRedditPost(url, options);
  options.signal?.throwIfAborted();
  const content = formatRedditMarkdown(redditPost);

  return {
    cacheable: redditPost.cacheable,
    cacheTtlMs: redditPost.cacheTtlMs,
    finalUrl: redditPost.url,
    result: {
      title: redditPost.post.title || redditPost.url,
      content,
      wordCount: countWords(content),
      contentType: "application/atom+xml",
      extractor: "reddit",
    },
  };
}

export function formatRedditMarkdown(result: RedditFetchResult): string {
  const lines = [
    `# ${singleLine(result.post.title || "Reddit post")}`,
    "",
    "Source: Reddit",
    `URL: ${result.url}`,
    result.subreddit ? `Subreddit: r/${singleLine(result.subreddit)}` : undefined,
    result.post.author ? `Author: ${singleLine(result.post.author)}` : undefined,
    result.post.published ? `Published: ${singleLine(result.post.published)}` : undefined,
    "",
    "## Post",
    "",
    result.post.content || "No post text returned by Reddit RSS.",
    "",
    "## Comments",
    "",
    ...formatComments(result.comments),
  ];

  return lines.filter((line): line is string => line !== undefined).join("\n").trim();
}

function formatComments(comments: RedditComment[]): string[] {
  if (comments.length === 0) return ["No comments returned by Reddit RSS."];

  return comments.flatMap((comment, index) => {
    const lines = [
      `### ${formatCommentTitle(comment, index)}`,
      "",
      comment.published ? `Published: ${singleLine(comment.published)}` : undefined,
      comment.link ? `Link: ${singleLine(comment.link)}` : undefined,
      comment.published || comment.link ? "" : undefined,
      comment.content || "No comment text returned by Reddit RSS.",
    ];

    return [...lines.filter((line): line is string => line !== undefined), ""];
  });
}

function formatCommentTitle(comment: RedditComment, index: number): string {
  return comment.author ? singleLine(comment.author) : `Comment ${index + 1}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}
