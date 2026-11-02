import { validationError } from "./errors.js";
import {
  fetchPublicHttpUrl,
  readBytesCapped,
  type FetchPublicHttpOptions,
} from "./http.js";

const FETCH_TIMEOUT_MS = 15000;
const MAX_YOUTUBE_RESPONSE_BYTES = 5 * 1024 * 1024;
export const YOUTUBE_CACHE_TTL_MS = 60 * 60_000;
export const YOUTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
/**
 * InnerTube client identity for the player request. The ANDROID client is the one whose caption
 * URLs still work without a proof-of-origin token, and the user agent is its matching client string.
 */
export const YOUTUBE_CLIENT_NAME = "ANDROID";
export const YOUTUBE_CLIENT_VERSION = "20.10.38";
export const YOUTUBE_USER_AGENT =
  `com.google.android.youtube/${YOUTUBE_CLIENT_VERSION} (Linux; U; Android 13) gzip`;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YOUTUBE_SHORT_LINK_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const VIDEO_PATH_PREFIXES = new Set(["e", "embed", "live", "shorts", "v"]);
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const SRV3_CUE_PATTERN = /<p\b([^>]*?)(?:\/>|>([\s\S]*?)<\/p>)/giu;
const LEGACY_CUE_PATTERN = /<text\b([^>]*?)(?:\/>|>([\s\S]*?)<\/text>)/giu;
const XML_ENTITY_PATTERN = /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/giu;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

type YouTubeFetchOptions = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "retryDelayMs" | "signal" | "wait"
>;

export interface YouTubeVideoUrl {
  videoId: string;
  canonicalUrl: string;
}

export interface YouTubeCaptionTrack {
  /** Display name from YouTube, such as "English (auto-generated)". */
  name: string;
  languageCode: string;
  /** True for automatic speech recognition tracks. */
  automatic: boolean;
  url: string;
}

export interface YouTubeTranscriptCue {
  startMs: number;
  durationMs: number;
  text: string;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  author: string;
  channelId: string;
  description: string;
  durationSeconds?: number;
  viewCount?: number;
  live: boolean;
}

export interface YouTubeTranscript {
  track: YouTubeCaptionTrack;
  cues: YouTubeTranscriptCue[];
}

export interface YouTubeFetchResult {
  cacheable: boolean;
  cacheTtlMs: number;
  url: string;
  video: YouTubeVideo;
  tracks: YouTubeCaptionTrack[];
  /** Absent when YouTube lists no caption tracks for the video. */
  transcript?: YouTubeTranscript;
}

/**
 * Fetches a YouTube video's details and the transcript of its preferred caption track.
 *
 * The InnerTube player endpoint returns the metadata and caption track list; the selected
 * track's timed-text XML is fetched second. Results are marked cacheable for a fixed window
 * regardless of upstream cache directives because the derived document, not the API response,
 * is what gets cached, and paginated reads of long transcripts rely on that cache.
 */
export async function fetchYouTubeVideo(
  url: string,
  options: YouTubeFetchOptions = {},
): Promise<YouTubeFetchResult> {
  const videoUrl = requireYouTubeVideoUrl(url);
  const player = await fetchPlayerResponse(videoUrl.videoId, options);
  options.signal?.throwIfAborted();

  const playability = asRecord(player.playabilityStatus);
  const status = asString(playability.status) || "UNKNOWN";
  if (status !== "OK") {
    throw validationError(describePlayability(status, asString(playability.reason).trim()));
  }

  const details = asRecord(player.videoDetails);
  const video: YouTubeVideo = {
    id: asString(details.videoId) || videoUrl.videoId,
    title: asString(details.title).trim(),
    author: asString(details.author).trim(),
    channelId: asString(details.channelId),
    description: asString(details.shortDescription).replace(/\r\n?/gu, "\n").trim(),
    durationSeconds: asNumber(details.lengthSeconds),
    viewCount: asNumber(details.viewCount),
    live: details.isLiveContent === true,
  };

  const tracks = parseCaptionTracks(player);
  const track = selectCaptionTrack(tracks);
  const transcript = track
    ? { track, cues: await fetchTranscriptCues(track, options) }
    : undefined;
  options.signal?.throwIfAborted();

  return {
    cacheable: true,
    cacheTtlMs: YOUTUBE_CACHE_TTL_MS,
    url: videoUrl.canonicalUrl,
    video,
    tracks,
    transcript,
  };
}

export function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return YOUTUBE_HOSTS.has(hostname) || YOUTUBE_SHORT_LINK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export function youtubeVideoCacheKey(rawUrl: string): string {
  return `youtube-video:${requireYouTubeVideoUrl(rawUrl).videoId}`;
}

export function requireYouTubeVideoUrl(rawUrl: string): YouTubeVideoUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw validationError("Invalid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw validationError("Unsupported protocol");
  }
  if (!isYouTubeUrl(rawUrl)) {
    throw validationError("Only YouTube video URLs are supported");
  }
  if (url.username || url.password) {
    throw validationError("Credentials not allowed");
  }

  const videoId = parseVideoId(url);
  if (!videoId) {
    throw validationError("URL must be a YouTube video URL like https://www.youtube.com/watch?v=VIDEO_ID");
  }

  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

/** Prefers manual English captions, then automatic English, then any manual track, then any track. */
export function selectCaptionTrack(
  tracks: readonly YouTubeCaptionTrack[],
): YouTubeCaptionTrack | undefined {
  return (
    tracks.find((track) => isEnglish(track) && !track.automatic) ??
    tracks.find((track) => isEnglish(track)) ??
    tracks.find((track) => !track.automatic) ??
    tracks[0]
  );
}

/** Parses YouTube timed text, either the `srv3` `<p t d>` format or the legacy `<text start dur>` format. */
export function parseTimedText(xml: string): YouTubeTranscriptCue[] {
  const cues = [...xml.matchAll(SRV3_CUE_PATTERN)].flatMap((match) =>
    cueFromMatch(match[1], match[2], "t", "d", 1),
  );
  if (cues.length > 0 || !/<text\b/iu.test(xml)) return cues;
  return [...xml.matchAll(LEGACY_CUE_PATTERN)].flatMap((match) =>
    cueFromMatch(match[1], match[2], "start", "dur", 1000),
  );
}

async function fetchPlayerResponse(
  videoId: string,
  options: YouTubeFetchOptions,
): Promise<Record<string, unknown>> {
  const { res } = await fetchPublicHttpUrl(YOUTUBE_PLAYER_URL, {
    ...options,
    body: JSON.stringify({
      context: {
        client: {
          clientName: YOUTUBE_CLIENT_NAME,
          clientVersion: YOUTUBE_CLIENT_VERSION,
          hl: "en",
        },
      },
      videoId,
    }),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    method: "POST",
    timeoutMs: FETCH_TIMEOUT_MS,
    userAgent: YOUTUBE_USER_AGENT,
  });
  const text = decodeUtf8(await readBytesCapped(res, MAX_YOUTUBE_RESPONSE_BYTES, options.signal));

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Malformed YouTube player response: not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Malformed YouTube player response: expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function fetchTranscriptCues(
  track: YouTubeCaptionTrack,
  options: YouTubeFetchOptions,
): Promise<YouTubeTranscriptCue[]> {
  const { res } = await fetchPublicHttpUrl(track.url, {
    ...options,
    headers: { Accept: "text/xml, application/xml, */*" },
    timeoutMs: FETCH_TIMEOUT_MS,
    userAgent: YOUTUBE_USER_AGENT,
  });
  const xml = decodeUtf8(await readBytesCapped(res, MAX_YOUTUBE_RESPONSE_BYTES, options.signal));
  if (!xml.trim()) {
    throw new Error(`YouTube returned an empty response for the "${track.name}" caption track`);
  }
  return parseTimedText(xml);
}

function describePlayability(status: string, reason: string): string {
  const message = `YouTube cannot play this video (${status})${reason ? `: ${reason}` : ""}`;
  return status === "LOGIN_REQUIRED"
    ? `${message}. Age-restricted and private videos are not supported without sign-in.`
    : message;
}

function parseCaptionTracks(player: Record<string, unknown>): YouTubeCaptionTrack[] {
  const renderer = asRecord(asRecord(player.captions).playerCaptionsTracklistRenderer);
  const rawTracks = Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
  return rawTracks.flatMap((raw): YouTubeCaptionTrack[] => {
    const track = asRecord(raw);
    const url = asString(track.baseUrl);
    const languageCode = asString(track.languageCode).trim();
    if (!url || !languageCode || !isYouTubeCaptionUrl(url)) return [];
    return [{
      name: textRuns(track.name) || languageCode,
      languageCode,
      automatic: asString(track.kind) === "asr",
      url,
    }];
  });
}

function isYouTubeCaptionUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "youtube.com" || hostname.endsWith(".youtube.com"));
  } catch {
    return false;
  }
}

function isEnglish(track: YouTubeCaptionTrack): boolean {
  return /^en(?:[-_]|$)/iu.test(track.languageCode);
}

function cueFromMatch(
  attributes: string,
  inner: string | undefined,
  startAttribute: string,
  durationAttribute: string,
  scale: number,
): YouTubeTranscriptCue[] {
  const text = cueText(inner ?? "");
  if (!text) return [];
  return [{
    startMs: Math.round((attributeNumber(attributes, startAttribute) ?? 0) * scale),
    durationMs: Math.round((attributeNumber(attributes, durationAttribute) ?? 0) * scale),
    text,
  }];
}

function attributeNumber(attributes: string, name: string): number | undefined {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "u"));
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function cueText(inner: string): string {
  return decodeXmlEntities(inner.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function decodeXmlEntities(text: string): string {
  return text.replace(XML_ENTITY_PATTERN, (entity, decimal?: string, hex?: string, named?: string) => {
    if (named) return NAMED_ENTITIES[named.toLowerCase()] ?? entity;
    const codePoint = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? "", 16);
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  });
}

function textRuns(value: unknown): string {
  const record = asRecord(value);
  const simple = asString(record.simpleText).trim();
  if (simple) return simple;
  const runs = Array.isArray(record.runs) ? record.runs : [];
  return runs.map((run) => asString(asRecord(run).text)).join("").trim();
}

function parseVideoId(url: URL): string | undefined {
  const hostname = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  let candidate: string | undefined;

  if (YOUTUBE_SHORT_LINK_HOSTS.has(hostname)) {
    candidate = parts.length === 1 ? parts[0] : undefined;
  } else if (parts[0]?.toLowerCase() === "watch") {
    if (parts.length === 1) candidate = url.searchParams.get("v") ?? undefined;
    else if (parts.length === 2) candidate = parts[1];
  } else if (parts.length === 2 && VIDEO_PATH_PREFIXES.has(parts[0].toLowerCase())) {
    candidate = parts[1];
  }

  return candidate && VIDEO_ID_PATTERN.test(candidate) ? candidate : undefined;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
