import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchUrlContent } from "../build/content/fetch.js";
import { fetchRedditContent, formatRedditMarkdown } from "../build/content/reddit.js";
import {
  fetchRedditPost,
  isRedditUrl,
  redditPostCacheKey,
  redditRateLimitResetSeconds,
  redditResponseCachePolicy,
  requireRedditPostUrl,
  REDDIT_CACHE_TTL_MS,
  REDDIT_USER_AGENT,
} from "../build/lib/reddit.js";

test("formats Reddit post and comments as markdown with links preserved", () => {
  const markdown = formatRedditMarkdown({
    url: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/example/",
    subreddit: "LocalLLaMA",
    post: {
      id: "t3_abc123",
      title: "Example Reddit Post",
      author: "/u/poster",
      published: "2026-07-06T12:00:00.000Z",
      link: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/example/",
      contentHtml: '<div class="md"><p>This is the <strong>post</strong> body with <a href="https://example.com/docs">a link</a>.</p></div>',
      contentText: "This is the post body with a link.",
    },
    comments: [
      {
        id: "t1_comment1",
        author: "/u/commenter",
        published: "2026-07-06T12:30:00.000Z",
        link: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/example/comment1/",
        contentHtml: '<div class="md"><p>This is a useful comment.</p><pre><code>npm test\n</code></pre></div>',
        contentText: "This is a useful comment. npm test",
      },
      {
        id: "t1_comment2",
        author: "",
        published: "",
        link: "",
        contentHtml: "",
        contentText: "Plain fallback text",
      },
    ],
  });

  assert.match(markdown, /^# Example Reddit Post/);
  assert.match(markdown, /Source: Reddit/);
  assert.match(markdown, /Subreddit: r\/LocalLLaMA/);
  assert.match(markdown, /## Post\n\nThis is the \*\*post\*\* body with \[a link\]\(https:\/\/example\.com\/docs\)\./);
  assert.match(markdown, /## Comments \(2\)/);
  assert.match(markdown, /### \/u\/commenter/);
  assert.match(markdown, /This is a useful comment\.\n\n```\nnpm test\n```/);
  assert.match(markdown, /### Comment 2\n\nPlain fallback text/);
});

test("describes link posts by their outbound URL", () => {
  const markdown = formatRedditMarkdown({
    url: "https://www.reddit.com/r/LocalLLaMA/comments/link123/release/",
    subreddit: "LocalLLaMA",
    post: {
      id: "t3_link123",
      title: "New model release",
      author: "/u/poster",
      published: "",
      link: "https://www.reddit.com/r/LocalLLaMA/comments/link123/release/",
      contentHtml: "",
      contentText: "",
      externalUrl: "https://example.com/blog/release?utm=1&x=2",
    },
    comments: [],
  });

  assert.match(markdown, /Link: https:\/\/example\.com\/blog\/release\?utm=1&x=2/);
  assert.match(markdown, /## Post\n\nLink post without text\./);
  assert.match(markdown, /## Comments \(0\)\n\nNo comments returned by Reddit\./);
});

test("rejects non-post Reddit URLs before generic fetching", async () => {
  await assert.rejects(
    () => fetchUrlContent("https://www.reddit.com/r/LocalLLaMA/"),
    /URL must be a Reddit post URL/,
  );
  await assert.rejects(
    () => fetchUrlContent("https://www.reddit.com/user/someone/comments/"),
    /URL must be a Reddit post URL/,
  );
});

test("parses post, comment-permalink, and short-link URL forms", () => {
  assert.deepEqual(
    requireRedditPostUrl("https://old.reddit.com/r/LocalLLaMA/comments/abc123/some_title/?utm_source=x#top"),
    {
      canonicalUrl: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/some_title/",
      rssUrl: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/some_title/.rss",
      subreddit: "LocalLLaMA",
      postId: "abc123",
      slug: "some_title",
    },
  );
  assert.equal(
    requireRedditPostUrl("https://www.reddit.com/r/LocalLLaMA/comments/abc123/some_title/zzz999/").rssUrl,
    "https://www.reddit.com/r/LocalLLaMA/comments/abc123/some_title/.rss",
  );
  assert.equal(
    requireRedditPostUrl("https://www.reddit.com/comments/abc123/").rssUrl,
    "https://www.reddit.com/comments/abc123/.rss",
  );
  assert.equal(
    requireRedditPostUrl("https://redd.it/abc123").rssUrl,
    "https://www.reddit.com/comments/abc123/.rss",
  );
  assert.equal(isRedditUrl("https://redd.it/abc123"), true);
  assert.equal(isRedditUrl("https://example.com/r/LocalLLaMA/comments/abc123/"), false);
  assert.throws(() => requireRedditPostUrl("https://redd.it/abc123/extra"), /URL must be a Reddit post URL/);
  assert.throws(() => requireRedditPostUrl("http://www.reddit.com/r/LocalLLaMA/comments/abc123/"), /Only HTTPS/);
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
  assert.equal(result.subreddit, "LocalLLaMA");
  assert.equal(result.post.title, "Post title");
  assert.equal(result.post.contentHtml, '<div class="md"><p>Post body with <a href="https://example.com/ref?a=1&amp;b=2">a link</a></p></div>');
  assert.equal(result.post.externalUrl, undefined);
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].author, "/u/commenter");
  assert.equal(result.comments[0].contentHtml, '<div class="md"><p>Comment body</p></div>');
});

test("fetches the Atom feed directly and never requests old Reddit HTML", async () => {
  const requests = [];
  const result = await fetchRedditContent(
    "https://old.reddit.com/r/LocalLLaMA/comments/abc123/input-title/?utm_source=test#comments",
    {
      fetchImpl: async (url, init) => {
        requests.push({ headers: init.headers, url });
        return new Response(redditFeedXml(), {
          headers: {
            "cache-control": "private, max-age=3600",
            "content-type": "application/atom+xml; charset=UTF-8",
          },
        });
      },
      lookupHost: publicLookup,
    },
  );

  assert.deepEqual(
    requests.map((request) => request.url),
    ["https://www.reddit.com/r/LocalLLaMA/comments/abc123/input-title/.rss"],
  );
  assert.equal(requests[0].headers["User-Agent"], REDDIT_USER_AGENT);
  assert.equal(result.finalUrl, "https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/");
  assert.equal(result.result.extractor, "reddit");
  assert.equal(result.result.contentType, "application/atom+xml");
  assert.equal(result.result.title, "Post title");
  assert.match(result.result.content, /## Post\n\nPost body with \[a link\]\(https:\/\/example\.com\/ref\?a=1&b=2\)/);
  assert.match(result.result.content, /### \/u\/commenter\n\n[\s\S]*Comment body/);
  assert.doesNotMatch(result.result.content, /submitted by/);
  assert.equal(result.cacheable, true);
  assert.equal(result.cacheTtlMs, REDDIT_CACHE_TTL_MS);
});

test("resolves subreddit and canonical URL from the feed for short links", async () => {
  const requests = [];
  const result = await fetchRedditPost("https://redd.it/ABC123", {
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(redditFeedXml(), {
        headers: { "content-type": "application/atom+xml" },
      });
    },
    lookupHost: publicLookup,
  });

  assert.deepEqual(requests, ["https://www.reddit.com/comments/ABC123/.rss"]);
  assert.equal(result.url, "https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/");
  assert.equal(result.subreddit, "LocalLLaMA");
});

test("extracts the outbound URL of link posts from the feed", async () => {
  const result = await fetchRedditPost("https://www.reddit.com/r/LocalLLaMA/comments/link123/release/", {
    fetchImpl: async () =>
      new Response(redditLinkPostFeedXml(), {
        headers: { "content-type": "application/atom+xml" },
      }),
    lookupHost: publicLookup,
  });

  assert.equal(result.post.externalUrl, "https://example.com/blog/release?utm=1&x=2");
  assert.equal(result.post.contentHtml, "");
  assert.equal(result.post.contentText, "");
});

test("canonicalizes Reddit cache keys by post ID", () => {
  assert.equal(
    redditPostCacheKey(
      "https://old.reddit.com/r/LocalLLaMA/comments/ABC123/one-title/?utm_source=test#comments",
    ),
    redditPostCacheKey("https://www.reddit.com/r/LocalLLaMA/comments/abc123/another-title/"),
  );
  assert.equal(
    redditPostCacheKey("https://redd.it/abc123"),
    redditPostCacheKey("https://www.reddit.com/comments/ABC123/"),
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

test("does not retry Reddit RSS on HTTP 429 and reports the throttle window", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchRedditPost("https://www.reddit.com/r/LocalLLaMA/comments/def456/title/", {
        fetchImpl: async () => {
          calls += 1;
          return new Response("", {
            status: 429,
            headers: { "x-ratelimit-reset": "58", "x-ratelimit-remaining": "0.0" },
          });
        },
        lookupHost: publicLookup,
      }),
    (err) => {
      assert.equal(err.name, "HttpStatusError");
      assert.equal(err.status, 429);
      assert.equal(err.retryable, true);
      assert.match(err.message, /^HTTP status 429: Reddit throttles anonymous feed requests/);
      assert.match(err.message, /retry after 58s$/);
      return true;
    },
  );

  assert.equal(calls, 1);
  assert.equal(redditRateLimitResetSeconds(new Headers({ "x-ratelimit-reset": "12.4" })), 13);
  assert.equal(redditRateLimitResetSeconds(new Headers({ "retry-after": "30" })), 30);
  assert.equal(redditRateLimitResetSeconds(new Headers()), undefined);
});

function redditFeedXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Post title : LocalLLaMA</title>
  <entry>
    <id>t3_abc123</id>
    <title>Post title</title>
    <author><name>/u/poster</name></author>
    <updated>2026-07-06T20:55:08Z</updated>
    <link href="https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/" />
    <content type="html">&lt;table&gt; &lt;tr&gt;&lt;td&gt; &lt;a href="https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/"&gt; &lt;img src="https://external-preview.redd.it/thumb.png" alt="Post title" title="Post title" /&gt; &lt;/a&gt; &lt;/td&gt;&lt;td&gt; &lt;!-- SC_OFF --&gt;&lt;div class="md"&gt;&lt;p&gt;Post body with &lt;a href="https://example.com/ref?a=1&amp;amp;b=2"&gt;a link&lt;/a&gt;&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href="https://www.reddit.com/user/poster"&gt; /u/poster &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href="https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/"&gt;[link]&lt;/a&gt;&lt;/span&gt; &amp;#32; &lt;span&gt;&lt;a href="https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/"&gt;[comments]&lt;/a&gt;&lt;/span&gt; &lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</content>
  </entry>
  <entry>
    <id>t1_comment1</id>
    <title>/u/commenter on Post title</title>
    <author><name>/u/commenter</name></author>
    <updated>2026-07-06T21:00:00Z</updated>
    <link href="https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/comment1/" />
    <content type="html">&lt;!-- SC_OFF --&gt;&lt;div class="md"&gt;&lt;p&gt;Comment body&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt;</content>
  </entry>
</feed>`;
}

function redditLinkPostFeedXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>New model release : LocalLLaMA</title>
  <entry>
    <id>t3_link123</id>
    <title>New model release</title>
    <author><name>/u/poster</name></author>
    <updated>2026-07-06T20:55:08Z</updated>
    <link href="https://www.reddit.com/r/LocalLLaMA/comments/link123/release/" />
    <content type="html">&amp;#32; submitted by &amp;#32; &lt;a href="https://www.reddit.com/user/poster"&gt; /u/poster &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href="https://example.com/blog/release?utm=1&amp;amp;x=2"&gt;[link]&lt;/a&gt;&lt;/span&gt; &amp;#32; &lt;span&gt;&lt;a href="https://www.reddit.com/r/LocalLLaMA/comments/link123/release/"&gt;[comments]&lt;/a&gt;&lt;/span&gt;</content>
  </entry>
</feed>`;
}

async function publicLookup() {
  return [{ address: "151.101.1.140", family: 4 }];
}

function responseWithCacheControl(cacheControl) {
  return new Response("content", { headers: { "cache-control": cacheControl } });
}
