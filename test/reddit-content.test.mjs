import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchUrlContent } from "../build/content/fetch.js";
import { fetchRedditContent, formatRedditMarkdown } from "../build/content/reddit.js";
import {
  fetchRedditPost,
  redditPostCacheKey,
  redditResponseCachePolicy,
  REDDIT_CACHE_TTL_MS,
  REDDIT_USER_AGENT,
} from "../build/lib/reddit.js";

test("formats Reddit post and comments as markdown", () => {
  const markdown = formatRedditMarkdown({
    url: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/example/",
    subreddit: "LocalLLaMA",
    post: {
      id: "abc123",
      title: "Example Reddit Post",
      author: "u/poster",
      published: "2026-07-06T12:00:00.000Z",
      link: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/example/",
      content: "This is the post body.",
    },
    comments: [
      {
        id: "comment1",
        author: "u/commenter",
        published: "2026-07-06T12:30:00.000Z",
        link: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/example/comment1/",
        content: "This is a useful comment.",
      },
    ],
  });

  assert.match(markdown, /^# Example Reddit Post/);
  assert.match(markdown, /Source: Reddit/);
  assert.match(markdown, /Subreddit: r\/LocalLLaMA/);
  assert.match(markdown, /## Post\n\nThis is the post body\./);
  assert.match(markdown, /## Comments/);
  assert.match(markdown, /### u\/commenter/);
  assert.match(markdown, /This is a useful comment\./);
});

test("rejects non-post Reddit URLs before generic fetching", async () => {
  await assert.rejects(
    () => fetchUrlContent("https://www.reddit.com/r/LocalLLaMA/"),
    /URL must be a Reddit post URL/,
  );
});

test("fetches Reddit RSS with descriptive headers, no retry, and public DNS validation", async () => {
  let calls = 0;
  let seenUrl;
  let seenHeaders;
  let lookupCalls = 0;

  const result = await fetchRedditPost("https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/", {
    fetchImpl: async (url, init) => {
      calls += 1;
      seenUrl = url;
      seenHeaders = init.headers;
      return new Response(redditFeedXml(), {
        headers: {
          "cache-control": "private, max-age=3600",
          "content-type": "application/atom+xml",
        },
      });
    },
    lookupHost: async () => {
      lookupCalls += 1;
      return [{ address: "151.101.1.140", family: 4 }];
    },
  });

  assert.equal(calls, 1);
  assert.equal(lookupCalls, 1);
  assert.equal(seenUrl, "https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/.rss");
  assert.deepEqual(Object.keys(seenHeaders), ["User-Agent", "Accept"]);
  assert.equal(seenHeaders["User-Agent"], REDDIT_USER_AGENT);
  assert.equal(seenHeaders.Accept, "application/atom+xml, application/xml, text/xml, */*");
  assert.equal(result.cacheable, true);
  assert.equal(result.cacheTtlMs, REDDIT_CACHE_TTL_MS);
  assert.equal(result.post.title, "Post title");
  assert.equal(result.comments.length, 1);
});

test("fetches old Reddit HTML first and returns the canonical post URL", async () => {
  const requests = [];
  const result = await fetchRedditContent(
    "https://www.reddit.com/r/LocalLLaMA/comments/html123/input-title/?utm_source=test#comments",
    {
      fetchImpl: async (url, init) => {
        requests.push({ headers: init.headers, url });
        return new Response("<html><body>Reddit post</body></html>", {
          headers: {
            "cache-control": "private, max-age=3600",
            "content-type": "text/html; charset=UTF-8",
          },
        });
      },
      lookupHost: publicLookup,
      extractHtml: async (_html, finalUrl) => ({
        title: "HTML post",
        content: `Post and nested comments from ${finalUrl}`,
        wordCount: 8,
      }),
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://old.reddit.com/r/LocalLLaMA/comments/html123/input-title/",
  );
  assert.equal(requests[0].headers["User-Agent"], REDDIT_USER_AGENT);
  assert.equal(requests[0].headers.Accept, "text/html, application/xhtml+xml");
  assert.equal(
    result.finalUrl,
    "https://www.reddit.com/r/LocalLLaMA/comments/html123/input-title/",
  );
  assert.equal(result.result.extractor, "reddit");
  assert.match(result.result.content, /Post and nested comments/);
  assert.equal(result.cacheable, true);
  assert.equal(result.cacheTtlMs, REDDIT_CACHE_TTL_MS);
});

test("falls back once to Reddit RSS when old Reddit HTML fails", async () => {
  const requests = [];
  const result = await fetchRedditContent(
    "https://www.reddit.com/r/LocalLLaMA/comments/fallback123/title/",
    {
      fetchImpl: async (url) => {
        requests.push(url);
        if (url.startsWith("https://old.reddit.com/")) {
          return new Response("rate limited", { status: 429 });
        }
        return new Response(redditFeedXml(), {
          headers: {
            "cache-control": "private, max-age=3600",
            "content-type": "application/atom+xml",
          },
        });
      },
      lookupHost: publicLookup,
    },
  );

  assert.deepEqual(requests, [
    "https://old.reddit.com/r/LocalLLaMA/comments/fallback123/title/",
    "https://www.reddit.com/r/LocalLLaMA/comments/fallback123/title/.rss",
  ]);
  assert.equal(result.result.extractor, "reddit");
  assert.match(result.result.content, /## Comments/);
  assert.equal(result.cacheTtlMs, REDDIT_CACHE_TTL_MS);
});

test("canonicalizes Reddit cache keys by post ID", () => {
  assert.equal(
    redditPostCacheKey(
      "https://old.reddit.com/r/LocalLLaMA/comments/ABC123/one-title/?utm_source=test#comments",
    ),
    redditPostCacheKey("https://www.reddit.com/r/LocalLLaMA/comments/abc123/another-title/"),
  );
});

test("caps Reddit cache TTL at one hour and honors no-store", () => {
  assert.deepEqual(redditResponseCachePolicy(responseWithCacheControl("private, max-age=60")), {
    cacheable: true,
    cacheTtlMs: 60_000,
  });
  assert.deepEqual(redditResponseCachePolicy(responseWithCacheControl("max-age=7200")), {
    cacheable: true,
    cacheTtlMs: REDDIT_CACHE_TTL_MS,
  });
  assert.deepEqual(redditResponseCachePolicy(responseWithCacheControl("no-store, max-age=3600")), {
    cacheable: false,
    cacheTtlMs: REDDIT_CACHE_TTL_MS,
  });
});

test("does not retry Reddit RSS on HTTP 429", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchRedditPost("https://www.reddit.com/r/LocalLLaMA/comments/def456/title/", {
        fetchImpl: async () => {
          calls += 1;
          return new Response("", { status: 429 });
        },
      }),
    /HTTP status 429/,
  );

  assert.equal(calls, 1);
});

function redditFeedXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Post title : LocalLLaMA</title>
  <entry>
    <id>post-id</id>
    <title>Post title</title>
    <author><name>/u/poster</name></author>
    <updated>2026-07-06T20:55:08Z</updated>
    <link href="https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/" />
    <content type="html">Post body [link] [comments]</content>
  </entry>
  <entry>
    <id>comment-id</id>
    <title>Comment title</title>
    <author><name>/u/commenter</name></author>
    <updated>2026-07-06T21:00:00Z</updated>
    <link href="https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/comment/" />
    <content type="html">Comment body</content>
  </entry>
</feed>`;
}

async function publicLookup() {
  return [{ address: "151.101.1.140", family: 4 }];
}

function responseWithCacheControl(cacheControl) {
  return new Response("content", { headers: { "cache-control": cacheControl } });
}
