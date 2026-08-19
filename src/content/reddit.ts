import { fetchRedditPost, type RedditComment, type RedditFetchResult } from "../lib/reddit.js";

export interface RedditMarkdown {
  title: string;
  content: string;
  wordCount: number;
  extractor: "reddit";
}

export async function fetchRedditContent(
  url: string,
  signal?: AbortSignal,
): Promise<{ finalUrl: string; result: RedditMarkdown & { contentType: string } }> {
  const redditPost = await fetchRedditPost(url, { signal });
  signal?.throwIfAborted();
  const content = formatRedditMarkdown(redditPost);

  return {
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
