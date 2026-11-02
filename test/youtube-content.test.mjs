import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchUrlContent } from "../build/content/fetch.js";
import {
  fetchYouTubeContent,
  formatYouTubeMarkdown,
  groupTranscript,
} from "../build/content/youtube.js";
import { classifyError } from "../build/lib/errors.js";
import {
  fetchYouTubeVideo,
  parseTimedText,
  requireYouTubeVideoUrl,
  selectCaptionTrack,
  youtubeVideoCacheKey,
  YOUTUBE_CACHE_TTL_MS,
  YOUTUBE_PLAYER_URL,
  YOUTUBE_USER_AGENT,
} from "../build/lib/youtube.js";

const publicLookup = async () => [{ address: "142.250.72.238", family: 4 }];
const noWait = async () => {};
const VIDEO_ID = "dQw4w9WgXcQ";
const CANONICAL_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const CAPTION_BASE = "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&signature=abc";

const SRV3_XML = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">
<head><ws id="0"/><wp id="0"/></head>
<body>
<w t="0" id="1" wp="1" ws="1"/>
<p t="1360" d="1680">[Music]</p>
<p t="18790" w="1" a="1">
</p>
<p t="18800" d="7160" w="1"><s ac="0">We&#39;re</s><s t="239" ac="0"> no</s><s t="559" ac="0"> strangers</s></p>
<p t="22640" d="4320">You know the rules
and so do I &amp; you &lt;3</p>
<p t="32000" d="2000">Second paragraph starts here</p>
<p t="3723000" d="1000">Over an hour</p>
</body>
</timedtext>`;

function track({
  lang = "en",
  name = "English",
  kind,
  url = `${CAPTION_BASE}&lang=${lang}${kind ? `&kind=${kind}` : ""}`,
} = {}) {
  return {
    baseUrl: url,
    languageCode: lang,
    name: { runs: [{ text: name }] },
    ...(kind ? { kind } : {}),
  };
}

function playerResponse({
  status = "OK",
  reason,
  captions = true,
  tracks = [track()],
  details = {},
} = {}) {
  const body = { playabilityStatus: { status, ...(reason ? { reason } : {}) } };
  if (status !== "OK") return body;

  body.videoDetails = {
    videoId: VIDEO_ID,
    title: "Example Video",
    author: "Example Channel",
    channelId: "UC123",
    lengthSeconds: "213",
    viewCount: "1234567",
    shortDescription: "Line one\r\nLine two",
    isLiveContent: false,
    ...details,
  };
  if (captions) {
    body.captions = { playerCaptionsTracklistRenderer: { captionTracks: tracks } };
  }
  return body;
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function xmlResponse(xml) {
  return new Response(xml, { status: 200, headers: { "content-type": "text/xml" } });
}

function fetchOptions(fetchImpl) {
  return { fetchImpl, lookupHost: publicLookup, wait: noWait, retryDelayMs: 0 };
}

test("parses YouTube video URL forms", () => {
  const forms = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=share",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/v/dQw4w9WgXcQ",
    "http://youtu.be/dQw4w9WgXcQ",
  ];

  for (const url of forms) {
    assert.deepEqual(
      requireYouTubeVideoUrl(url),
      { videoId: VIDEO_ID, canonicalUrl: CANONICAL_URL },
      url,
    );
  }
});

test("rejects YouTube URLs that do not name a video", () => {
  const rejected = [
    ["https://www.youtube.com/@rickastley", /URL must be a YouTube video URL/],
    ["https://www.youtube.com/playlist?list=PL123", /URL must be a YouTube video URL/],
    ["https://www.youtube.com/watch", /URL must be a YouTube video URL/],
    ["https://www.youtube.com/watch?v=tooshort", /URL must be a YouTube video URL/],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ/extra", /URL must be a YouTube video URL/],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ/more", /URL must be a YouTube video URL/],
    ["https://youtu.be/", /URL must be a YouTube video URL/],
    ["ftp://youtu.be/dQw4w9WgXcQ", /Unsupported protocol/],
    ["https://user:pass@youtu.be/dQw4w9WgXcQ", /Credentials not allowed/],
    ["https://example.com/watch?v=dQw4w9WgXcQ", /Only YouTube video URLs are supported/],
    ["not a url", /Invalid URL/],
  ];

  for (const [url, pattern] of rejected) {
    assert.throws(() => requireYouTubeVideoUrl(url), pattern, url);
  }
});

test("rejects non-video YouTube URLs before generic fetching", async () => {
  await assert.rejects(
    () => fetchUrlContent("https://www.youtube.com/@rickastley"),
    /URL must be a YouTube video URL/,
  );
});

test("fetches the player response and the preferred caption track", async () => {
  const requests = [];
  const lookups = [];

  const result = await fetchYouTubeVideo("https://youtu.be/dQw4w9WgXcQ?t=5", {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) {
        return jsonResponse(playerResponse({
          tracks: [
            track({ lang: "de", name: "German" }),
            track({ kind: "asr", name: "English (auto-generated)" }),
            track(),
          ],
        }));
      }
      return xmlResponse(SRV3_XML);
    },
    lookupHost: async (hostname) => {
      lookups.push(hostname);
      return publicLookup();
    },
    wait: noWait,
  });

  assert.equal(requests.length, 2);
  const [player, captions] = requests;
  assert.equal(player.url, YOUTUBE_PLAYER_URL);
  assert.equal(player.init.method, "POST");
  assert.equal(player.init.redirect, "manual");
  assert.equal(player.init.headers["User-Agent"], YOUTUBE_USER_AGENT);
  assert.equal(player.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(player.init.body), {
    context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } },
    videoId: VIDEO_ID,
  });
  assert.equal(captions.url, `${CAPTION_BASE}&lang=en`);
  assert.equal(captions.init.method, "GET");
  assert.equal(captions.init.headers["User-Agent"], YOUTUBE_USER_AGENT);
  assert.deepEqual(lookups, ["www.youtube.com", "www.youtube.com"]);

  assert.equal(result.url, CANONICAL_URL);
  assert.equal(result.cacheable, true);
  assert.equal(result.cacheTtlMs, YOUTUBE_CACHE_TTL_MS);
  assert.deepEqual(result.video, {
    id: VIDEO_ID,
    title: "Example Video",
    author: "Example Channel",
    channelId: "UC123",
    description: "Line one\nLine two",
    durationSeconds: 213,
    viewCount: 1234567,
    live: false,
  });
  assert.deepEqual(
    result.tracks.map((item) => [item.name, item.languageCode, item.automatic]),
    [["German", "de", false], ["English (auto-generated)", "en", true], ["English", "en", false]],
  );
  assert.equal(result.transcript.track.name, "English");
  assert.equal(result.transcript.track.automatic, false);
  assert.equal(result.transcript.cues.length, 5);
});

test("selects caption tracks by preference", () => {
  const en = { name: "English", languageCode: "en", automatic: false, url: "u1" };
  const enAsr = { name: "English (auto-generated)", languageCode: "en", automatic: true, url: "u2" };
  const enGb = { name: "English (United Kingdom)", languageCode: "en-GB", automatic: false, url: "u3" };
  const de = { name: "German", languageCode: "de", automatic: false, url: "u4" };
  const koAsr = { name: "Korean (auto-generated)", languageCode: "ko", automatic: true, url: "u5" };

  assert.equal(selectCaptionTrack([koAsr, de, enAsr, en]), en);
  assert.equal(selectCaptionTrack([koAsr, de, enAsr]), enAsr);
  assert.equal(selectCaptionTrack([koAsr, de, enGb]), enGb);
  assert.equal(selectCaptionTrack([koAsr, de]), de);
  assert.equal(selectCaptionTrack([koAsr]), koAsr);
  assert.equal(selectCaptionTrack([]), undefined);
});

test("parses srv3 timed text with word spans, entities, and line breaks", () => {
  const cues = parseTimedText(SRV3_XML);

  assert.equal(cues.length, 5);
  assert.deepEqual(cues.slice(0, 3), [
    { startMs: 1360, durationMs: 1680, text: "[Music]" },
    { startMs: 18800, durationMs: 7160, text: "We're no strangers" },
    { startMs: 22640, durationMs: 4320, text: "You know the rules and so do I & you <3" },
  ]);
  assert.deepEqual(cues[4], { startMs: 3723000, durationMs: 1000, text: "Over an hour" });
});

test("parses legacy transcript XML", () => {
  const cues = parseTimedText(
    '<?xml version="1.0" encoding="utf-8"?><transcript><text start="1.5" dur="2.25">Hello &amp; welcome</text><text start="4" dur="1"></text><text start="5.1">Bye &#x1F44B;</text></transcript>',
  );

  assert.deepEqual(cues, [
    { startMs: 1500, durationMs: 2250, text: "Hello & welcome" },
    { startMs: 5100, durationMs: 0, text: "Bye 👋" },
  ]);
  assert.deepEqual(parseTimedText(""), []);
});

test("groups transcript cues into timed paragraphs", () => {
  const paragraphs = groupTranscript([
    { startMs: 0, durationMs: 1000, text: "one" },
    { startMs: 29999, durationMs: 1000, text: "two" },
    { startMs: 30000, durationMs: 1000, text: "three" },
    { startMs: 70000, durationMs: 1000, text: "four" },
  ]);

  assert.deepEqual(paragraphs, [
    { startMs: 0, text: "one two" },
    { startMs: 30000, text: "three" },
    { startMs: 70000, text: "four" },
  ]);
});

test("formats YouTube markdown with metadata, description, and timestamped transcript", () => {
  const english = { name: "English", languageCode: "en", automatic: false, url: "u1" };
  const markdown = formatYouTubeMarkdown({
    cacheable: true,
    cacheTtlMs: YOUTUBE_CACHE_TTL_MS,
    url: CANONICAL_URL,
    video: {
      id: VIDEO_ID,
      title: "Example\n Video",
      author: "Example Channel",
      channelId: "UC123",
      description: "Line one\nLine two",
      durationSeconds: 3723,
      viewCount: 1234567,
      live: false,
    },
    tracks: [english, { name: "German", languageCode: "de", automatic: false, url: "u2" }],
    transcript: { track: english, cues: parseTimedText(SRV3_XML) },
  });

  assert.match(markdown, /^# Example Video\n/);
  assert.match(
    markdown,
    /\nSource: YouTube\nURL: https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ\nChannel: Example Channel\nDuration: 1:02:03\nViews: 1,234,567\nTranscript: English \[en\]\nCaption tracks: English, German\n/,
  );
  assert.match(markdown, /## Description\n\nLine one\nLine two\n/);
  assert.match(
    markdown,
    /## Transcript\n\n\[0:01\] \[Music\] We're no strangers You know the rules and so do I & you <3\n\n\[0:32\] Second paragraph starts here\n\n\[1:02:03\] Over an hour$/,
  );
});

test("labels automatic transcripts and summarizes long caption track lists", () => {
  const tracks = Array.from({ length: 14 }, (_, index) => ({
    name: `Lang ${index}`,
    languageCode: `l${index}`,
    automatic: true,
    url: `u${index}`,
  }));
  const markdown = formatYouTubeMarkdown({
    cacheable: true,
    cacheTtlMs: YOUTUBE_CACHE_TTL_MS,
    url: CANONICAL_URL,
    video: { id: VIDEO_ID, title: "", author: "", channelId: "", description: "", live: true },
    tracks,
    transcript: { track: tracks[0], cues: [] },
  });

  assert.match(markdown, /^# YouTube video\n/);
  assert.match(
    markdown,
    /\nLive stream: yes\nTranscript: Lang 0 \(auto-generated\) \[l0\]\nCaption tracks: Lang 0, Lang 1, Lang 2, Lang 3, Lang 4, Lang 5, Lang 6, Lang 7, Lang 8, Lang 9, Lang 10, Lang 11, and 2 more\n/,
  );
  assert.match(markdown, /## Description\n\nNo description\.\n/);
  assert.match(markdown, /## Transcript\n\nThe Lang 0 \(auto-generated\) \[l0\] caption track is empty\.$/);
});

test("returns metadata without a transcript when YouTube lists no caption tracks", async () => {
  let calls = 0;
  const fetched = await fetchYouTubeContent(CANONICAL_URL, fetchOptions(async () => {
    calls += 1;
    return jsonResponse(playerResponse({ captions: false }));
  }));

  assert.equal(calls, 1);
  assert.equal(fetched.finalUrl, CANONICAL_URL);
  assert.equal(fetched.cacheable, true);
  assert.equal(fetched.cacheTtlMs, YOUTUBE_CACHE_TTL_MS);
  assert.equal(fetched.result.extractor, "youtube");
  assert.equal(fetched.result.contentType, "application/json");
  assert.equal(fetched.result.title, "Example Video");
  assert.match(fetched.result.content, /\nTranscript: none\n/);
  assert.doesNotMatch(fetched.result.content, /Caption tracks:/);
  assert.match(
    fetched.result.content,
    /## Transcript\n\nNo transcript is available: YouTube lists no caption tracks for this video\.$/,
  );
  assert.equal(fetched.result.wordCount, fetched.result.content.split(/\s+/).length);
});

test("skips caption tracks that are not served over HTTPS by YouTube", async () => {
  let calls = 0;
  const result = await fetchYouTubeVideo(CANONICAL_URL, fetchOptions(async () => {
    calls += 1;
    return jsonResponse(playerResponse({
      tracks: [
        track({ url: "https://captions.example.com/timedtext?v=dQw4w9WgXcQ" }),
        track({ url: "http://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ" }),
        { baseUrl: `${CAPTION_BASE}&lang=en`, name: { runs: [{ text: "No language" }] } },
      ],
    }));
  }));

  assert.equal(calls, 1);
  assert.deepEqual(result.tracks, []);
  assert.equal(result.transcript, undefined);
});

test("reports unplayable videos as validation errors", async () => {
  await assert.rejects(
    () =>
      fetchYouTubeVideo(CANONICAL_URL, fetchOptions(async () =>
        jsonResponse(playerResponse({ status: "ERROR", reason: "This video is unavailable" })))),
    (err) => {
      assert.equal(err.message, "YouTube cannot play this video (ERROR): This video is unavailable");
      assert.equal(classifyError(err).category, "validation");
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchYouTubeVideo(CANONICAL_URL, fetchOptions(async () =>
        jsonResponse(playerResponse({ status: "LOGIN_REQUIRED", reason: "Sign in to confirm your age" })))),
    /YouTube cannot play this video \(LOGIN_REQUIRED\): Sign in to confirm your age\. Age-restricted and private videos are not supported without sign-in\.$/,
  );
});

test("fails when the caption track response is empty", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchYouTubeVideo(CANONICAL_URL, fetchOptions(async () => {
        calls += 1;
        return calls === 1 ? jsonResponse(playerResponse()) : new Response("", { status: 200 });
      })),
    /YouTube returned an empty response for the "English" caption track$/,
  );
  assert.equal(calls, 2);
});

test("propagates caption track HTTP errors", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchYouTubeVideo(CANONICAL_URL, fetchOptions(async () => {
        calls += 1;
        return calls === 1 ? jsonResponse(playerResponse()) : new Response("missing", { status: 404 });
      })),
    (err) => {
      assert.match(err.message, /^HTTP status 404$/);
      assert.equal(classifyError(err).category, "http");
      assert.equal(classifyError(err).retryable, false);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("classifies malformed player responses as parse errors", async () => {
  await assert.rejects(
    () =>
      fetchYouTubeVideo(CANONICAL_URL, fetchOptions(async () =>
        new Response("<html>bot check</html>", { status: 200, headers: { "content-type": "text/html" } }))),
    (err) => {
      assert.match(err.message, /^Malformed YouTube player response: not valid JSON$/);
      assert.equal(classifyError(err).category, "parse");
      return true;
    },
  );
});

test("caches YouTube URL variants under the video ID", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return {
      cacheTtlMs: YOUTUBE_CACHE_TTL_MS,
      finalUrl: "https://www.youtube.com/watch?v=cacheVid123",
      result: {
        title: "Cached video",
        content: "stable transcript",
        wordCount: 2,
        contentType: "application/json",
        extractor: "youtube",
      },
    };
  };

  const first = await fetchUrlContent("https://youtu.be/cacheVid123?t=10", load);
  const second = await fetchUrlContent("https://www.youtube.com/watch?v=cacheVid123&list=PL1", load);
  const third = await fetchUrlContent("https://m.youtube.com/shorts/cacheVid123", load);

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(first, third);
  assert.equal(youtubeVideoCacheKey("https://youtu.be/cacheVid123"), "youtube-video:cacheVid123");
  assert.notEqual(
    youtubeVideoCacheKey("https://youtu.be/CACHEVID123"),
    youtubeVideoCacheKey("https://youtu.be/cacheVid123"),
  );
});
