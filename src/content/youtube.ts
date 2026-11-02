import type { FetchPublicHttpOptions } from "../lib/http.js";
import {
  fetchYouTubeVideo,
  type YouTubeCaptionTrack,
  type YouTubeFetchResult,
  type YouTubeTranscriptCue,
} from "../lib/youtube.js";

type YouTubeContentOptions = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "retryDelayMs" | "signal" | "wait"
>;

/** Transcript cues are merged into paragraphs that each cover about this much playback time. */
export const TRANSCRIPT_PARAGRAPH_MS = 30_000;
const MAX_LISTED_TRACKS = 12;

export interface YouTubeMarkdown {
  title: string;
  content: string;
  wordCount: number;
  extractor: "youtube";
}

export interface TranscriptParagraph {
  startMs: number;
  text: string;
}

export async function fetchYouTubeContent(
  url: string,
  options: YouTubeContentOptions = {},
): Promise<{
  cacheable?: boolean;
  cacheTtlMs?: number;
  finalUrl: string;
  result: YouTubeMarkdown & { contentType: string };
}> {
  const fetched = await fetchYouTubeVideo(url, options);
  options.signal?.throwIfAborted();
  const content = formatYouTubeMarkdown(fetched);

  return {
    cacheable: fetched.cacheable,
    cacheTtlMs: fetched.cacheTtlMs,
    finalUrl: fetched.url,
    result: {
      title: fetched.video.title || fetched.url,
      content,
      wordCount: countWords(content),
      contentType: "application/json",
      extractor: "youtube",
    },
  };
}

export function formatYouTubeMarkdown(result: YouTubeFetchResult): string {
  const { video, transcript } = result;
  const lines = [
    `# ${singleLine(video.title || "YouTube video")}`,
    "",
    "Source: YouTube",
    `URL: ${result.url}`,
    video.author ? `Channel: ${singleLine(video.author)}` : undefined,
    video.durationSeconds !== undefined ? `Duration: ${formatClock(video.durationSeconds * 1000)}` : undefined,
    video.viewCount !== undefined ? `Views: ${video.viewCount.toLocaleString("en-US")}` : undefined,
    video.live ? "Live stream: yes" : undefined,
    `Transcript: ${transcript ? describeTrack(transcript.track) : "none"}`,
    result.tracks.length > 0 ? `Caption tracks: ${listTracks(result.tracks)}` : undefined,
    "",
    "## Description",
    "",
    video.description || "No description.",
    "",
    "## Transcript",
    "",
    ...formatTranscript(result),
  ];

  return lines.filter((line): line is string => line !== undefined).join("\n").trim();
}

/** Merges consecutive cues into paragraphs so each paragraph starts at most `windowMs` after the previous one. */
export function groupTranscript(
  cues: readonly YouTubeTranscriptCue[],
  windowMs = TRANSCRIPT_PARAGRAPH_MS,
): TranscriptParagraph[] {
  const paragraphs: Array<{ startMs: number; parts: string[] }> = [];
  let current: { startMs: number; parts: string[] } | undefined;

  for (const cue of cues) {
    if (!current || cue.startMs - current.startMs >= windowMs) {
      current = { startMs: cue.startMs, parts: [] };
      paragraphs.push(current);
    }
    current.parts.push(cue.text);
  }

  return paragraphs.map((paragraph) => ({
    startMs: paragraph.startMs,
    text: paragraph.parts.join(" "),
  }));
}

function formatTranscript(result: YouTubeFetchResult): string[] {
  if (!result.transcript) {
    return [
      result.tracks.length === 0
        ? "No transcript is available: YouTube lists no caption tracks for this video."
        : "No transcript is available for this video.",
    ];
  }

  const paragraphs = groupTranscript(result.transcript.cues);
  if (paragraphs.length === 0) {
    return [`The ${describeTrack(result.transcript.track)} caption track is empty.`];
  }
  return paragraphs.flatMap((paragraph) => [
    `[${formatClock(paragraph.startMs)}] ${paragraph.text}`,
    "",
  ]);
}

function describeTrack(track: YouTubeCaptionTrack): string {
  const name = track.automatic && !/auto/iu.test(track.name)
    ? `${track.name} (auto-generated)`
    : track.name;
  return `${singleLine(name)} [${track.languageCode}]`;
}

function listTracks(tracks: readonly YouTubeCaptionTrack[]): string {
  const names = tracks.slice(0, MAX_LISTED_TRACKS).map((track) => singleLine(track.name));
  const remaining = tracks.length - names.length;
  return remaining > 0 ? `${names.join(", ")}, and ${remaining} more` : names.join(", ");
}

function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}
