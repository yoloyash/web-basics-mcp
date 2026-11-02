import { validationError } from "./errors.js";
import {
  fetchPublicHttpUrl,
  HttpStatusError,
  readBytesCapped,
  responseAllowsCaching,
  type FetchPublicHttpOptions,
} from "./http.js";

const FETCH_TIMEOUT_MS = 15000;
const MAX_X_RESPONSE_BYTES = 2 * 1024 * 1024;
export const X_SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result";
export const X_OEMBED_URL = "https://publish.x.com/oembed";
/** Feature flags the embedded-tweet widget sends; they shape which fields the syndication API returns. */
const X_SYNDICATION_FEATURES = [
  "tfw_timeline_list:",
  "tfw_follower_count_sunset:true",
  "tfw_tweet_edit_backend:on",
  "tfw_refsrc_session:on",
  "tfw_fosnr_soft_interventions_enabled:on",
  "tfw_show_birdwatch_pivots_enabled:on",
  "tfw_show_business_verified_badge:on",
  "tfw_duplicate_scribes_to_settings:on",
  "tfw_use_profile_image_shape_enabled:on",
  "tfw_show_blue_verified_badge:on",
  "tfw_legacy_timeline_sunset:true",
  "tfw_show_gov_verified_badge:on",
  "tfw_show_business_affiliate_badge:on",
  "tfw_tweet_edit_frontend:on",
].join(";");
const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);
const POST_ID_PATTERN = /^\d{1,19}$/u;
const SCREEN_NAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;
const AUTHOR_URL_PATTERN = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/u;
const HTML_ENTITY_PATTERN = /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip));/giu;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
};

type XFetchOptions = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "retryDelayMs" | "signal" | "wait"
>;

export interface XPostUrl {
  postId: string;
  /** Empty when the URL does not name the author (`x.com/i/status/<id>` links). */
  screenName: string;
  canonicalUrl: string;
}

export interface XUser {
  name: string;
  screenName: string;
}

export interface XMedia {
  type: "photo" | "video" | "gif";
  /** Image URL, or the poster frame for videos and GIFs. */
  url: string;
  altText?: string;
  /** Highest-bitrate MP4 variant for videos and GIFs. */
  videoUrl?: string;
}

export interface XLinkCard {
  title: string;
  description: string;
  domain: string;
  url: string;
}

export interface XRelatedPost {
  id: string;
  url: string;
  user: XUser;
  /** Post text with t.co links expanded and media links removed. */
  text: string;
  /** True when X served only the leading part of a long post. */
  truncated: boolean;
  createdAt: string;
  media: XMedia[];
}

export interface XPost extends XRelatedPost {
  language?: string;
  likeCount?: number;
  replyCount?: number;
  card?: XLinkCard;
  inReplyTo?: { screenName: string; postId: string; url: string };
  parent?: XRelatedPost;
  quoted?: XRelatedPost;
}

export interface XFetchResult {
  cacheable: boolean;
  url: string;
  post: XPost;
  source: "syndication" | "oembed";
  /** Set when the syndication endpoint failed and the oEmbed endpoint supplied the post. */
  fallbackReason?: string;
}

/**
 * Fetches an X post from the public syndication endpoint that powers embedded posts, falling back
 * to the official oEmbed endpoint (text only) when the syndication request fails.
 */
export async function fetchXPost(url: string, options: XFetchOptions = {}): Promise<XFetchResult> {
  const postUrl = requireXPostUrl(url);

  let syndicationError: unknown;
  try {
    return await fetchSyndicationPost(postUrl, options);
  } catch (err) {
    options.signal?.throwIfAborted();
    syndicationError = err;
  }

  try {
    const fallback = await fetchOembedPost(postUrl, options);
    return {
      ...fallback,
      fallbackReason: `Syndication API failed: ${errorMessage(syndicationError)}`,
    };
  } catch {
    options.signal?.throwIfAborted();
    throw syndicationError;
  }
}

export function isXUrl(rawUrl: string): boolean {
  try {
    return X_HOSTS.has(new URL(rawUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function xPostCacheKey(rawUrl: string): string {
  return `x-post:${requireXPostUrl(rawUrl).postId}`;
}

export function requireXPostUrl(rawUrl: string): XPostUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw validationError("Invalid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw validationError("Unsupported protocol");
  }
  if (!isXUrl(rawUrl)) {
    throw validationError("Only X post URLs are supported");
  }
  if (url.username || url.password) {
    throw validationError("Credentials not allowed");
  }

  const postUrl = parsePostPath(url.pathname);
  if (!postUrl) {
    throw validationError("URL must be an X post URL like https://x.com/username/status/1234567890");
  }
  return postUrl;
}

/** Token the embedded-post widget derives from the post ID; the syndication endpoint requires one. */
export function syndicationToken(postId: string): string {
  return ((Number(postId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/gu, "");
}

async function fetchSyndicationPost(postUrl: XPostUrl, options: XFetchOptions): Promise<XFetchResult> {
  const url = new URL(X_SYNDICATION_URL);
  url.searchParams.set("id", postUrl.postId);
  url.searchParams.set("lang", "en");
  url.searchParams.set("features", X_SYNDICATION_FEATURES);
  url.searchParams.set("token", syndicationToken(postUrl.postId));

  let res: Response;
  try {
    ({ res } = await fetchPublicHttpUrl(url.toString(), {
      ...options,
      headers: { Accept: "application/json" },
      timeoutMs: FETCH_TIMEOUT_MS,
    }));
  } catch (err) {
    if (err instanceof HttpStatusError && err.status === 404) {
      err.message =
        `${err.message}: X post ${postUrl.postId} was not found; it may be deleted, ` +
        "from a protected account, or never have existed";
    }
    throw err;
  }

  const data = parseJsonObject(await readText(res, options), "X syndication response");
  if (asString(data.__typename) === "TweetTombstone") {
    throw validationError(`X withheld this post: ${tombstoneText(data) || "no reason given"}`);
  }
  if (Object.keys(data).length === 0) {
    throw validationError(`X post ${postUrl.postId} was not found`);
  }

  const post = parseSyndicationPost(data, postUrl);
  return { cacheable: responseAllowsCaching(res), url: post.url, post, source: "syndication" };
}

async function fetchOembedPost(postUrl: XPostUrl, options: XFetchOptions): Promise<XFetchResult> {
  const url = new URL(X_OEMBED_URL);
  url.searchParams.set("url", postUrl.canonicalUrl);
  url.searchParams.set("omit_script", "true");
  url.searchParams.set("dnt", "true");

  const { res } = await fetchPublicHttpUrl(url.toString(), {
    ...options,
    headers: { Accept: "application/json" },
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  const data = parseJsonObject(await readText(res, options), "X oEmbed response");
  const html = asString(data.html);
  const paragraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/iu)?.[1] ?? "";
  if (!paragraph.trim()) {
    throw new Error("Malformed X oEmbed response: no post text");
  }

  const text = decodeHtmlEntities(
    paragraph.replace(/<br\s*\/?>/giu, "\n").replace(/<[^>]+>/gu, ""),
  ).trim();
  const canonicalUrl = asString(data.url);
  const id = canonicalUrl.match(/\/status\/(\d+)/u)?.[1] ?? postUrl.postId;
  const screenName = asString(data.author_url).match(AUTHOR_URL_PATTERN)?.[1] ?? postUrl.screenName;
  const dateText = html.match(/<a\s[^>]*>([^<]+)<\/a>\s*<\/blockquote>/iu)?.[1] ?? "";
  const post: XPost = {
    id,
    url: buildPostUrl(screenName, id),
    user: { name: asString(data.author_name).trim() || screenName, screenName },
    text,
    truncated: text.endsWith("…"),
    createdAt: isoDate(dateText),
    media: [],
  };

  return { cacheable: responseAllowsCaching(res), url: post.url, post, source: "oembed" };
}

function parseSyndicationPost(data: Record<string, unknown>, postUrl: XPostUrl): XPost {
  const base = parseRelatedPost(data, postUrl.postId);
  const inReplyToId = asString(data.in_reply_to_status_id_str);
  const inReplyToScreenName = asString(data.in_reply_to_screen_name);
  const parent = asRecord(data.parent);
  const quoted = asRecord(data.quoted_tweet);

  return {
    ...base,
    language: asString(data.lang) || undefined,
    likeCount: asNumber(data.favorite_count),
    replyCount: asNumber(data.conversation_count),
    card: parseCard(data),
    inReplyTo: inReplyToId
      ? {
        screenName: inReplyToScreenName,
        postId: inReplyToId,
        url: buildPostUrl(inReplyToScreenName, inReplyToId),
      }
      : undefined,
    parent: Object.keys(parent).length > 0 ? parseRelatedPost(parent, "") : undefined,
    quoted: Object.keys(quoted).length > 0 ? parseRelatedPost(quoted, "") : undefined,
  };
}

function parseRelatedPost(data: Record<string, unknown>, fallbackId: string): XRelatedPost {
  const user = parseUser(data.user);
  const id = asString(data.id_str) || fallbackId;
  const text = expandText(asString(data.text), asRecord(data.entities));

  return {
    id,
    url: buildPostUrl(user.screenName, id),
    user,
    text,
    truncated: Object.keys(asRecord(data.note_tweet)).length > 0 || text.endsWith("…"),
    createdAt: asString(data.created_at),
    media: parseMedia(data.mediaDetails),
  };
}

function parseUser(value: unknown): XUser {
  const user = asRecord(value);
  return {
    name: asString(user.name).trim(),
    screenName: asString(user.screen_name).trim(),
  };
}

function expandText(text: string, entities: Record<string, unknown>): string {
  let expanded = decodeHtmlEntities(text);
  for (const entity of asArray(entities.urls).map(asRecord)) {
    const short = asString(entity.url);
    const full = asString(entity.expanded_url);
    if (short && full) expanded = expanded.split(short).join(full);
  }
  for (const entity of asArray(entities.media).map(asRecord)) {
    const short = asString(entity.url);
    if (short) expanded = expanded.split(short).join("");
  }
  return expanded
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function parseMedia(value: unknown): XMedia[] {
  return asArray(value).flatMap((raw): XMedia[] => {
    const media = asRecord(raw);
    const type = asString(media.type);
    const url = asString(media.media_url_https);
    if (!url) return [];
    const altText = asString(media.ext_alt_text).trim();

    if (type === "photo") {
      return [{ type: "photo", url, ...(altText ? { altText } : {}) }];
    }
    if (type === "video" || type === "animated_gif") {
      const videoUrl = bestVideoVariant(media.video_info);
      return [{
        type: type === "video" ? "video" : "gif",
        url,
        ...(altText ? { altText } : {}),
        ...(videoUrl ? { videoUrl } : {}),
      }];
    }
    return [];
  });
}

function bestVideoVariant(value: unknown): string | undefined {
  const variants = asArray(asRecord(value).variants).map(asRecord);
  let best: { bitrate: number; url: string } | undefined;
  for (const variant of variants) {
    const url = asString(variant.url);
    if (!url || asString(variant.content_type) !== "video/mp4") continue;
    const bitrate = asNumber(variant.bitrate) ?? 0;
    if (!best || bitrate > best.bitrate) best = { bitrate, url };
  }
  return best?.url;
}

function parseCard(data: Record<string, unknown>): XLinkCard | undefined {
  const card = asRecord(data.card);
  const values = asRecord(card.binding_values);
  const title = bindingString(values, "title");
  if (!title) return undefined;

  const cardUrl = asString(card.url);
  const expanded = asArray(asRecord(data.entities).urls)
    .map(asRecord)
    .find((entity) => asString(entity.url) === cardUrl);

  return {
    title,
    description: bindingString(values, "description"),
    domain: bindingString(values, "domain") || bindingString(values, "vanity_url"),
    url: asString(expanded?.expanded_url) || cardUrl,
  };
}

function bindingString(values: Record<string, unknown>, key: string): string {
  return asString(asRecord(values[key]).string_value).trim();
}

function tombstoneText(data: Record<string, unknown>): string {
  return asString(asRecord(asRecord(data.tombstone).text).text).trim();
}

function parsePostPath(pathname: string): XPostUrl | undefined {
  const parts = pathname.split("/").filter(Boolean);
  let screenName = "";
  let postId: string | undefined;

  if (parts[0]?.toLowerCase() === "i") {
    const statusIndex = parts[1]?.toLowerCase() === "web" ? 2 : 1;
    if (parts[statusIndex]?.toLowerCase() === "status") postId = parts[statusIndex + 1];
  } else if (parts.length >= 3 && ["status", "statuses"].includes(parts[1].toLowerCase())) {
    screenName = parts[0];
    postId = parts[2];
  }

  if (!postId || !POST_ID_PATTERN.test(postId)) return undefined;
  if (screenName && !SCREEN_NAME_PATTERN.test(screenName)) return undefined;
  return { postId, screenName, canonicalUrl: buildPostUrl(screenName, postId) };
}

function buildPostUrl(screenName: string, postId: string): string {
  return screenName
    ? `https://x.com/${screenName}/status/${postId}`
    : `https://x.com/i/status/${postId}`;
}

function isoDate(text: string): string {
  const parsed = Date.parse(`${text.trim()} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
}

async function readText(res: Response, options: XFetchOptions): Promise<string> {
  const bytes = await readBytesCapped(res, MAX_X_RESPONSE_BYTES, options.signal);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Malformed ${label}: not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Malformed ${label}: expected a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function decodeHtmlEntities(text: string): string {
  return text.replace(HTML_ENTITY_PATTERN, (entity, decimal?: string, hex?: string, named?: string) => {
    if (named) return NAMED_ENTITIES[named.toLowerCase()] ?? entity;
    const codePoint = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? "", 16);
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
