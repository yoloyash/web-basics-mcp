import { htmlFragmentToMarkdown } from "./html.js";
import type { FetchPublicHttpOptions } from "../lib/http.js";
import {
  fetchRedditPost,
  type RedditComment,
  type RedditFetchResult,
} from "../lib/reddit.js";

type RedditContentOptions = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "retryDelayMs" | "signal" | "wait"
>;

export interface RedditMarkdown {
  title: string;
  content: string;
  wordCount: number;
  extractor: "reddit";
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
  const body = renderBody(result.post.contentHtml, result.post.contentText);
  const lines = [
    `# ${singleLine(result.post.title || "Reddit post")}`,
    "",
    "Source: Reddit",
    `URL: ${result.url}`,
    result.subreddit ? `Subreddit: r/${singleLine(result.subreddit)}` : undefined,
    result.post.author ? `Author: ${singleLine(result.post.author)}` : undefined,
    result.post.published ? `Published: ${singleLine(result.post.published)}` : undefined,
    result.post.externalUrl ? `Link: ${singleLine(result.post.externalUrl)}` : undefined,
    "",
    "## Post",
    "",
    body || (result.post.externalUrl ? "Link post without text." : "No post text returned by Reddit."),
    "",
    `## Comments (${result.comments.length})`,
    "",
    ...formatComments(result.comments),
  ];

  return lines.filter((line): line is string => line !== undefined).join("\n").trim();
}

function formatComments(comments: RedditComment[]): string[] {
  if (comments.length === 0) return ["No comments returned by Reddit."];

  return comments.flatMap((comment, index) => {
    const lines = [
      `### ${formatCommentTitle(comment, index)}`,
      "",
      comment.published ? `Published: ${singleLine(comment.published)}` : undefined,
      comment.link ? `Link: ${singleLine(comment.link)}` : undefined,
      comment.published || comment.link ? "" : undefined,
      renderBody(comment.contentHtml, comment.contentText) || "No comment text returned by Reddit.",
    ];

    return [...lines.filter((line): line is string => line !== undefined), ""];
  });
}

function renderBody(html: string, text: string): string {
  try {
    const markdown = htmlFragmentToMarkdown(html);
    if (markdown) return markdown;
  } catch {
    // Fall through to the plain-text snippet when the fragment cannot be converted.
  }
  return text.trim();
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
