import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchUrlContent, recommendedFetchConcurrency } from "../build/content/fetch.js";
import { formatRedditMarkdown } from "../build/content/reddit.js";
import { fetchRedditPost } from "../build/lib/reddit.js";

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

test("recommends sequential batch fetches when Reddit URLs are included", () => {
  assert.equal(recommendedFetchConcurrency(["https://example.com"], 3), 3);
  assert.equal(
    recommendedFetchConcurrency(["https://example.com", "https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/"], 3),
    1,
  );
});

test("fetches Reddit RSS with legacy headers, no retry, and no local DNS lookup", async () => {
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
        headers: { "content-type": "application/atom+xml" },
      });
    },
    lookupHost: async () => {
      lookupCalls += 1;
      throw new Error("lookup should not run for allowlisted Reddit URLs");
    },
  });

  assert.equal(calls, 1);
  assert.equal(lookupCalls, 0);
  assert.equal(seenUrl, "https://www.reddit.com/r/LocalLLaMA/comments/abc123/title/.rss");
  assert.deepEqual(Object.keys(seenHeaders), ["User-Agent", "Accept"]);
  assert.equal(seenHeaders.Accept, "application/atom+xml, application/xml, text/xml, */*");
  assert.equal(result.post.title, "Post title");
  assert.equal(result.comments.length, 1);
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
