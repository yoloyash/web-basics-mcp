import type { FetchPublicHttpOptions } from "../lib/http.js";
import {
  fetchXPost,
  type XFetchResult,
  type XLinkCard,
  type XMedia,
  type XPost,
  type XRelatedPost,
  type XUser,
} from "../lib/x.js";

type XContentOptions = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "retryDelayMs" | "signal" | "wait"
>;

const TITLE_SNIPPET_CHARS = 80;
const TRUNCATION_NOTE =
  "Note: X serves only the first 280 characters of long posts to logged-out clients, so this text is truncated.";
const OEMBED_NOTE =
  "Note: read from X's oEmbed endpoint; media, counts, and related posts are unavailable.";

export interface XMarkdown {
  title: string;
  content: string;
  wordCount: number;
  extractor: "x";
  fallbackReason?: string;
}

export async function fetchXContent(
  url: string,
  options: XContentOptions = {},
): Promise<{
  cacheable?: boolean;
  cacheTtlMs?: number;
  finalUrl: string;
  result: XMarkdown & { contentType: string };
}> {
  const fetched = await fetchXPost(url, options);
  options.signal?.throwIfAborted();
  const content = formatXMarkdown(fetched);

  return {
    cacheable: fetched.cacheable,
    finalUrl: fetched.url,
    result: {
      title: xPostTitle(fetched.post),
      content,
      wordCount: countWords(content),
      contentType: "application/json",
      extractor: "x",
      ...(fetched.fallbackReason ? { fallbackReason: fetched.fallbackReason } : {}),
    },
  };
}

export function xPostTitle(post: XPost): string {
  const author = describeUser(post.user);
  const snippet = singleLine(post.text);
  if (!snippet) return `${author} on X`;
  const shortened = snippet.length > TITLE_SNIPPET_CHARS
    ? `${snippet.slice(0, TITLE_SNIPPET_CHARS - 1).trimEnd()}…`
    : snippet;
  return `${author}: ${shortened}`;
}

export function formatXMarkdown(result: XFetchResult): string {
  const { post } = result;
  const lines = [
    `# ${describeUser(post.user)} on X`,
    "",
    "Source: X",
    `URL: ${post.url}`,
    `Author: ${describeUser(post.user)}`,
    post.createdAt ? `Published: ${singleLine(post.createdAt)}` : undefined,
    post.language ? `Language: ${singleLine(post.language)}` : undefined,
    post.likeCount !== undefined ? `Likes: ${post.likeCount.toLocaleString("en-US")}` : undefined,
    post.replyCount !== undefined ? `Replies: ${post.replyCount.toLocaleString("en-US")}` : undefined,
    post.inReplyTo
      ? `Replying to: ${post.inReplyTo.screenName ? `@${post.inReplyTo.screenName} ` : ""}${post.inReplyTo.url}`
      : undefined,
    result.source === "oembed" ? OEMBED_NOTE : undefined,
    post.truncated ? TRUNCATION_NOTE : undefined,
    "",
    "## Post",
    "",
    ...formatBody(post),
    ...(post.card ? ["", ...formatCard(post.card)] : []),
    ...(post.parent ? ["", "## In reply to", "", ...formatRelatedPost(post.parent)] : []),
    ...(post.quoted ? ["", "## Quoted post", "", ...formatRelatedPost(post.quoted)] : []),
  ];

  return lines
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function formatBody(post: XRelatedPost): string[] {
  const lines = [post.text || "No text."];
  if (post.media.length > 0) {
    lines.push("", "Media:", ...post.media.map(formatMedia));
  }
  return lines;
}

function formatMedia(media: XMedia): string {
  const alt = media.altText ? ` (alt: ${singleLine(media.altText)})` : "";
  if (media.type === "photo") return `- Photo: ${media.url}${alt}`;
  const label = media.type === "video" ? "Video" : "GIF";
  return media.videoUrl
    ? `- ${label}: ${media.videoUrl} (poster: ${media.url})${alt}`
    : `- ${label}: ${media.url}${alt}`;
}

function formatCard(card: XLinkCard): string[] {
  return [
    `Link card: ${singleLine(card.title)}${card.domain ? ` (${singleLine(card.domain)})` : ""}`,
    card.url ? `Link URL: ${singleLine(card.url)}` : undefined,
    card.description ? `Link description: ${singleLine(card.description)}` : undefined,
  ].filter((line): line is string => line !== undefined);
}

function formatRelatedPost(post: XRelatedPost): string[] {
  return [
    `Author: ${describeUser(post.user)}`,
    `URL: ${post.url}`,
    post.createdAt ? `Published: ${singleLine(post.createdAt)}` : undefined,
    post.truncated ? TRUNCATION_NOTE : undefined,
    "",
    ...formatBody(post),
  ].filter((line): line is string => line !== undefined);
}

function describeUser(user: XUser): string {
  const name = singleLine(user.name);
  if (!user.screenName) return name || "Unknown author";
  return name ? `${name} (@${user.screenName})` : `@${user.screenName}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}
