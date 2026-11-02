import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchUrlContent } from "../build/content/fetch.js";
import { fetchXContent, formatXMarkdown, xPostTitle } from "../build/content/x.js";
import { classifyError } from "../build/lib/errors.js";
import {
  fetchXPost,
  requireXPostUrl,
  syndicationToken,
  xPostCacheKey,
  X_OEMBED_URL,
  X_SYNDICATION_URL,
} from "../build/lib/x.js";

const publicLookup = async () => [{ address: "104.244.42.1", family: 4 }];
const noWait = async () => {};
const POST_ID = "2114780720170164735";
const PARENT_ID = "2114780717188272382";
const QUOTED_ID = "2113718797505036665";
const CANONICAL_URL = `https://x.com/OpenAI/status/${POST_ID}`;

function user(overrides = {}) {
  return {
    id_str: "4398626122",
    name: "OpenAI",
    screen_name: "OpenAI",
    verified: false,
    is_blue_verified: true,
    ...overrides,
  };
}

function syndicationPost(overrides = {}) {
  return {
    __typename: "Tweet",
    id_str: POST_ID,
    lang: "en",
    created_at: "2026-10-26T18:06:29.000Z",
    favorite_count: 1530,
    conversation_count: 43,
    display_text_range: [0, 217],
    entities: {},
    text: "Hello world",
    user: user(),
    ...overrides,
  };
}

function richSyndicationPost() {
  return syndicationPost({
    text: "Rolling out now &amp; available.\n\nDetails: https://t.co/TVsi7lEeX9 https://t.co/pzAmnvjBUi",
    entities: {
      urls: [{
        url: "https://t.co/TVsi7lEeX9",
        expanded_url: "https://openai.com/index/introducing/",
        display_url: "openai.com/index/introduc…",
        indices: [40, 63],
      }],
      media: [{
        url: "https://t.co/pzAmnvjBUi",
        expanded_url: `https://x.com/OpenAI/status/${POST_ID}/photo/1`,
        display_url: "pic.x.com/pzAmnvjBUi",
        indices: [64, 87],
      }],
    },
    mediaDetails: [
      {
        type: "photo",
        media_url_https: "https://pbs.twimg.com/media/photo.png",
        ext_alt_text: "Benchmark chart",
      },
      {
        type: "video",
        media_url_https: "https://pbs.twimg.com/poster.jpg",
        video_info: {
          variants: [
            { content_type: "application/x-mpegURL", url: "https://video.twimg.com/pl.m3u8" },
            { bitrate: 256000, content_type: "video/mp4", url: "https://video.twimg.com/low.mp4" },
            { bitrate: 2176000, content_type: "video/mp4", url: "https://video.twimg.com/high.mp4" },
          ],
        },
      },
      { type: "unknown", media_url_https: "https://pbs.twimg.com/ignored.png" },
    ],
    card: {
      name: "summary_large_image",
      url: "https://t.co/TVsi7lEeX9",
      binding_values: {
        title: { type: "STRING", string_value: "Introducing GPT" },
        description: { type: "STRING", string_value: "Fast and capable" },
        domain: { type: "STRING", string_value: "openai.com" },
      },
    },
    in_reply_to_status_id_str: PARENT_ID,
    in_reply_to_screen_name: "OpenAI",
    parent: {
      id_str: PARENT_ID,
      text: "Parent text https://t.co/parent",
      entities: { urls: [{ url: "https://t.co/parent", expanded_url: "https://example.com/parent" }] },
      user: user(),
      created_at: "2026-10-26T18:06:28.000Z",
      mediaDetails: [],
    },
    quoted_tweet: {
      id_str: QUOTED_ID,
      text: "Quoted text",
      entities: {},
      user: user({ name: "Other Person", screen_name: "other" }),
      created_at: "2026-10-23T19:46:46.000Z",
    },
    note_tweet: { id: "note1" },
  });
}

function oembedResponse(overrides = {}) {
  return {
    url: CANONICAL_URL,
    author_name: "OpenAI",
    author_url: "https://x.com/OpenAI",
    html:
      '<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">Line one &amp; more<br><br>Line two <a href="https://t.co/abc">https://t.co/abc</a></p>&mdash; OpenAI (@OpenAI) <a href="https://x.com/OpenAI/status/2114780720170164735?ref_src=twsrc%5Etfw">October 26, 2026</a></blockquote>\n\n',
    width: 550,
    height: null,
    type: "rich",
    cache_age: "3153600000",
    provider_name: "X",
    provider_url: "https://x.com",
    version: "1.0",
    ...overrides,
  };
}

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function notFoundResponse() {
  return new Response("<!DOCTYPE html><html><body>not found</body></html>", {
    status: 404,
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}

function fetchOptions(fetchImpl) {
  return { fetchImpl, lookupHost: publicLookup, wait: noWait, retryDelayMs: 0 };
}

function hostOf(url) {
  return new URL(url).hostname;
}

test("parses X post URL forms", () => {
  const expected = { postId: POST_ID, screenName: "OpenAI", canonicalUrl: CANONICAL_URL };
  for (const url of [
    `https://x.com/OpenAI/status/${POST_ID}?s=20&t=abc`,
    `https://twitter.com/OpenAI/status/${POST_ID}/photo/1`,
    `https://mobile.twitter.com/OpenAI/statuses/${POST_ID}`,
    `http://www.x.com/OpenAI/status/${POST_ID}`,
  ]) {
    assert.deepEqual(requireXPostUrl(url), expected, url);
  }

  const anonymous = { postId: POST_ID, screenName: "", canonicalUrl: `https://x.com/i/status/${POST_ID}` };
  assert.deepEqual(requireXPostUrl(`https://x.com/i/web/status/${POST_ID}`), anonymous);
  assert.deepEqual(requireXPostUrl(`https://x.com/i/status/${POST_ID}`), anonymous);
  assert.equal(requireXPostUrl(`https://x.com/openai/status/${POST_ID}`).canonicalUrl, `https://x.com/openai/status/${POST_ID}`);
});

test("rejects X URLs that do not name a post", () => {
  const rejected = [
    ["https://x.com/OpenAI", /URL must be an X post URL/],
    ["https://x.com/home", /URL must be an X post URL/],
    ["https://x.com/search?q=web-basics", /URL must be an X post URL/],
    ["https://x.com/OpenAI/status/abc", /URL must be an X post URL/],
    ["https://x.com/OpenAI/status/99999999999999999999", /URL must be an X post URL/],
    ["https://x.com/this_name_is_too_long_for_x/status/20", /URL must be an X post URL/],
    ["https://x.com/i/web/20", /URL must be an X post URL/],
    ["ftp://x.com/jack/status/20", /Unsupported protocol/],
    ["https://user:pass@x.com/jack/status/20", /Credentials not allowed/],
    ["https://example.com/jack/status/20", /Only X post URLs are supported/],
    ["not a url", /Invalid URL/],
  ];

  for (const [url, pattern] of rejected) {
    assert.throws(() => requireXPostUrl(url), pattern, url);
  }
});

test("rejects non-post X URLs before generic fetching", async () => {
  await assert.rejects(
    () => fetchUrlContent("https://x.com/OpenAI"),
    /URL must be an X post URL/,
  );
});

test("derives the syndication token from the post ID", () => {
  assert.equal(syndicationToken("20"), syndicationToken("20"));
  assert.match(syndicationToken(POST_ID), /^[0-9a-z]+$/);
  assert.notEqual(syndicationToken(POST_ID), syndicationToken(PARENT_ID));
  assert.doesNotMatch(syndicationToken("1000000000000000"), /[.0]/);
});

test("fetches the syndication endpoint and parses a rich post", async () => {
  const requests = [];
  const lookups = [];

  const result = await fetchXPost(`https://twitter.com/openai/status/${POST_ID}?s=20`, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse(richSyndicationPost(), { "cache-control": "must-revalidate, max-age=60" });
    },
    lookupHost: async (hostname) => {
      lookups.push(hostname);
      return publicLookup();
    },
    wait: noWait,
  });

  assert.equal(requests.length, 1);
  const request = new URL(requests[0].url);
  assert.equal(`${request.origin}${request.pathname}`, X_SYNDICATION_URL);
  assert.equal(request.searchParams.get("id"), POST_ID);
  assert.equal(request.searchParams.get("lang"), "en");
  assert.equal(request.searchParams.get("token"), syndicationToken(POST_ID));
  assert.match(request.searchParams.get("features"), /tfw_tweet_edit_backend:on/);
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.headers.Accept, "application/json");
  assert.deepEqual(lookups, ["cdn.syndication.twimg.com"]);

  assert.equal(result.source, "syndication");
  assert.equal(result.cacheable, true);
  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.url, CANONICAL_URL);

  const { post } = result;
  assert.equal(post.id, POST_ID);
  assert.equal(post.url, CANONICAL_URL);
  assert.deepEqual(post.user, { name: "OpenAI", screenName: "OpenAI" });
  assert.equal(post.text, "Rolling out now & available.\n\nDetails: https://openai.com/index/introducing/");
  assert.equal(post.truncated, true);
  assert.equal(post.createdAt, "2026-10-26T18:06:29.000Z");
  assert.equal(post.language, "en");
  assert.equal(post.likeCount, 1530);
  assert.equal(post.replyCount, 43);
  assert.deepEqual(post.media, [
    { type: "photo", url: "https://pbs.twimg.com/media/photo.png", altText: "Benchmark chart" },
    { type: "video", url: "https://pbs.twimg.com/poster.jpg", videoUrl: "https://video.twimg.com/high.mp4" },
  ]);
  assert.deepEqual(post.card, {
    title: "Introducing GPT",
    description: "Fast and capable",
    domain: "openai.com",
    url: "https://openai.com/index/introducing/",
  });
  assert.deepEqual(post.inReplyTo, {
    screenName: "OpenAI",
    postId: PARENT_ID,
    url: `https://x.com/OpenAI/status/${PARENT_ID}`,
  });
  assert.deepEqual(post.parent, {
    id: PARENT_ID,
    url: `https://x.com/OpenAI/status/${PARENT_ID}`,
    user: { name: "OpenAI", screenName: "OpenAI" },
    text: "Parent text https://example.com/parent",
    truncated: false,
    createdAt: "2026-10-26T18:06:28.000Z",
    media: [],
  });
  assert.deepEqual(post.quoted, {
    id: QUOTED_ID,
    url: `https://x.com/other/status/${QUOTED_ID}`,
    user: { name: "Other Person", screenName: "other" },
    text: "Quoted text",
    truncated: false,
    createdAt: "2026-10-23T19:46:46.000Z",
    media: [],
  });
});

test("parses a plain post without optional fields", async () => {
  const result = await fetchXPost("https://x.com/jack/status/20", fetchOptions(async () =>
    jsonResponse({
      __typename: "Tweet",
      id_str: "20",
      text: "just setting up my twttr",
      user: user({ name: "jack", screen_name: "jack" }),
      created_at: "2006-03-21T20:50:14.000Z",
      entities: {},
    })));

  assert.deepEqual(result.post, {
    id: "20",
    url: "https://x.com/jack/status/20",
    user: { name: "jack", screenName: "jack" },
    text: "just setting up my twttr",
    truncated: false,
    createdAt: "2006-03-21T20:50:14.000Z",
    media: [],
    language: undefined,
    likeCount: undefined,
    replyCount: undefined,
    card: undefined,
    inReplyTo: undefined,
    parent: undefined,
    quoted: undefined,
  });
});

test("formats X markdown with metadata, media, link card, and related posts", async () => {
  const fetched = await fetchXPost(CANONICAL_URL, fetchOptions(async () => jsonResponse(richSyndicationPost())));
  const markdown = formatXMarkdown(fetched);

  assert.equal(
    markdown,
    [
      "# OpenAI (@OpenAI) on X",
      "",
      "Source: X",
      `URL: ${CANONICAL_URL}`,
      "Author: OpenAI (@OpenAI)",
      "Published: 2026-10-26T18:06:29.000Z",
      "Language: en",
      "Likes: 1,530",
      "Replies: 43",
      `Replying to: @OpenAI https://x.com/OpenAI/status/${PARENT_ID}`,
      "Note: X serves only the first 280 characters of long posts to logged-out clients, so this text is truncated.",
      "",
      "## Post",
      "",
      "Rolling out now & available.",
      "",
      "Details: https://openai.com/index/introducing/",
      "",
      "Media:",
      "- Photo: https://pbs.twimg.com/media/photo.png (alt: Benchmark chart)",
      "- Video: https://video.twimg.com/high.mp4 (poster: https://pbs.twimg.com/poster.jpg)",
      "",
      "Link card: Introducing GPT (openai.com)",
      "Link URL: https://openai.com/index/introducing/",
      "Link description: Fast and capable",
      "",
      "## In reply to",
      "",
      "Author: OpenAI (@OpenAI)",
      `URL: https://x.com/OpenAI/status/${PARENT_ID}`,
      "Published: 2026-10-26T18:06:28.000Z",
      "",
      "Parent text https://example.com/parent",
      "",
      "## Quoted post",
      "",
      "Author: Other Person (@other)",
      `URL: https://x.com/other/status/${QUOTED_ID}`,
      "Published: 2026-10-23T19:46:46.000Z",
      "",
      "Quoted text",
    ].join("\n"),
  );
  assert.equal(xPostTitle(fetched.post), "OpenAI (@OpenAI): Rolling out now & available. Details: https://openai.com/index/introducing/");
});

test("builds titles from the author and a bounded text snippet", () => {
  const base = { id: "1", url: "https://x.com/a/status/1", truncated: false, createdAt: "", media: [] };
  assert.equal(
    xPostTitle({ ...base, user: { name: "Ada", screenName: "ada" }, text: "x".repeat(100) }),
    `Ada (@ada): ${"x".repeat(79)}…`,
  );
  assert.equal(xPostTitle({ ...base, user: { name: "", screenName: "ada" }, text: "" }), "@ada on X");
  assert.equal(xPostTitle({ ...base, user: { name: "Ada", screenName: "" }, text: "hi" }), "Ada: hi");
});

test("falls back to the oEmbed endpoint when the syndication endpoint fails", async () => {
  const requests = [];
  const fetched = await fetchXContent(`https://x.com/i/web/status/${POST_ID}`, fetchOptions(async (url, init) => {
    requests.push({ url, init });
    return hostOf(url) === "cdn.syndication.twimg.com" ? notFoundResponse() : jsonResponse(oembedResponse());
  }));

  assert.equal(requests.length, 2);
  const oembed = new URL(requests[1].url);
  assert.equal(`${oembed.origin}${oembed.pathname}`, X_OEMBED_URL);
  assert.equal(oembed.searchParams.get("url"), `https://x.com/i/status/${POST_ID}`);
  assert.equal(oembed.searchParams.get("omit_script"), "true");
  assert.equal(oembed.searchParams.get("dnt"), "true");
  assert.equal(requests[1].init.headers.Accept, "application/json");

  assert.equal(fetched.finalUrl, CANONICAL_URL);
  assert.equal(fetched.cacheable, true);
  assert.equal(fetched.result.extractor, "x");
  assert.equal(fetched.result.contentType, "application/json");
  assert.equal(fetched.result.title, "OpenAI (@OpenAI): Line one & more Line two https://t.co/abc");
  assert.match(
    fetched.result.fallbackReason,
    /^Syndication API failed: HTTP status 404: X post 2114780720170164735 was not found; it may be deleted, from a protected account, or never have existed$/,
  );
  assert.match(fetched.result.content, /^# OpenAI \(@OpenAI\) on X\n/);
  assert.match(fetched.result.content, /\nPublished: 2026-10-26\n/);
  assert.match(fetched.result.content, /\nNote: read from X's oEmbed endpoint; media, counts, and related posts are unavailable\.\n/);
  assert.match(fetched.result.content, /## Post\n\nLine one & more\n\nLine two https:\/\/t\.co\/abc$/);
  assert.doesNotMatch(fetched.result.content, /Likes:|Media:/);
  assert.equal(fetched.result.wordCount, fetched.result.content.split(/\s+/).length);
});

test("marks oEmbed text that ends with an ellipsis as truncated", async () => {
  const fetched = await fetchXPost(CANONICAL_URL, fetchOptions(async (url) =>
    hostOf(url) === "cdn.syndication.twimg.com"
      ? notFoundResponse()
      : jsonResponse(oembedResponse({
        html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Long post start&hellip;</p>&mdash; OpenAI (@OpenAI) <a href="https://x.com/OpenAI/status/1">October 26, 2026</a></blockquote>',
      }))));

  assert.equal(fetched.source, "oembed");
  assert.equal(fetched.post.text, "Long post start…");
  assert.equal(fetched.post.truncated, true);
  assert.match(formatXMarkdown(fetched), /so this text is truncated\./);
});

test("throws the syndication error when both endpoints fail", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchXPost(CANONICAL_URL, fetchOptions(async () => {
        calls += 1;
        return notFoundResponse();
      })),
    (err) => {
      assert.equal(err.name, "HttpStatusError");
      assert.equal(
        err.message,
        `HTTP status 404: X post ${POST_ID} was not found; it may be deleted, from a protected account, or never have existed`,
      );
      assert.equal(classifyError(err).category, "http");
      assert.equal(classifyError(err).retryable, false);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("reports withheld and missing posts as validation errors", async () => {
  await assert.rejects(
    () =>
      fetchXPost(CANONICAL_URL, fetchOptions(async (url) =>
        hostOf(url) === "cdn.syndication.twimg.com"
          ? jsonResponse({ __typename: "TweetTombstone", tombstone: { text: { text: "Age-restricted adult content." } } })
          : notFoundResponse())),
    (err) => {
      assert.equal(err.message, "X withheld this post: Age-restricted adult content.");
      assert.equal(classifyError(err).category, "validation");
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchXPost(CANONICAL_URL, fetchOptions(async (url) =>
        hostOf(url) === "cdn.syndication.twimg.com" ? jsonResponse({}) : notFoundResponse())),
    (err) => {
      assert.equal(err.message, `X post ${POST_ID} was not found`);
      assert.equal(classifyError(err).category, "validation");
      return true;
    },
  );
});

test("classifies malformed syndication responses as parse errors", async () => {
  await assert.rejects(
    () =>
      fetchXPost(CANONICAL_URL, fetchOptions(async () =>
        new Response("<html>bot check</html>", { status: 200, headers: { "content-type": "text/html" } }))),
    (err) => {
      assert.equal(err.message, "Malformed X syndication response: not valid JSON");
      assert.equal(classifyError(err).category, "parse");
      return true;
    },
  );
});

test("does not fall back after the caller cancels", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    () =>
      fetchXPost(CANONICAL_URL, {
        ...fetchOptions(async () => {
          calls += 1;
          return jsonResponse(syndicationPost());
        }),
        signal: controller.signal,
      }),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
});

test("honors no-store on syndication responses", async () => {
  const fetched = await fetchXContent(CANONICAL_URL, fetchOptions(async () =>
    jsonResponse(syndicationPost(), { "cache-control": "no-store" })));

  assert.equal(fetched.cacheable, false);
  assert.equal(fetched.cacheTtlMs, undefined);
});

test("caches X URL variants under the post ID", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return {
      finalUrl: "https://x.com/example/status/1234567890123456789",
      result: {
        title: "Cached post",
        content: "stable post",
        wordCount: 2,
        contentType: "application/json",
        extractor: "x",
      },
    };
  };

  const first = await fetchUrlContent("https://twitter.com/example/status/1234567890123456789?s=20", load);
  const second = await fetchUrlContent("https://x.com/i/web/status/1234567890123456789", load);
  const third = await fetchUrlContent("https://mobile.x.com/Example/status/1234567890123456789/photo/1", load);

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(first, third);
  assert.equal(xPostCacheKey("https://x.com/i/status/1234567890123456789"), "x-post:1234567890123456789");
});
