import assert from "node:assert/strict";
import { test } from "node:test";
import { researchQuery } from "../build/lib/research.js";

const encoder = new TextEncoder();

test("researchQuery validates blank queries before searching", async () => {
  let searched = false;

  await assert.rejects(
    () =>
      researchQuery("   ", {
        search: async () => {
          searched = true;
          return [];
        },
      }),
    /Query cannot be empty/,
  );

  assert.equal(searched, false);
});

test("researchQuery fetches the limited top results and preserves search metadata", async () => {
  const fetchedUrls = [];
  let seenQuery;

  const result = await researchQuery("  durable web research  ", {
    limit: 2,
    search: async (query) => {
      seenQuery = query;
      return [
        {
          url: "https://example.com/first",
          title: "First result",
          content: "First snippet",
          score: 3.5,
          engines: ["engine-a"],
        },
        {
          url: "https://example.com/second",
          title: "Second result",
          content: "Second snippet",
          score: 2,
          engines: ["engine-b", "engine-c"],
        },
        {
          url: "https://example.com/third",
          title: "Third result",
        },
      ];
    },
    fetchUrl: async (url) => {
      fetchedUrls.push(url);
      return {
        res: new Response("ignored", { headers: { "content-type": "text/html; charset=utf-8" } }),
        finalUrl: `${url}?final=1`,
      };
    },
    readBytes: async () => encoder.encode("html"),
    extractContent: async (_body, finalUrl, contentType) => ({
      title: `Fetched ${finalUrl}`,
      content: `content from ${finalUrl}`,
      wordCount: 4,
      contentType: contentType.split(";")[0],
      extractor: "readability",
    }),
  });

  assert.equal(seenQuery, "durable web research");
  assert.deepEqual(fetchedUrls, ["https://example.com/first", "https://example.com/second"]);
  assert.equal(result.query, "durable web research");
  assert.equal(result.fetched_count, 2);
  assert.equal(result.failed_count, 0);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results[0], {
    link: "https://example.com/first",
    title: "First result",
    snippet: "First snippet",
    search_score: 3.5,
    source_engines: ["engine-a"],
    fetched: true,
    final_url: "https://example.com/first?final=1",
    content: "content from https://example.com/first?final=1",
    word_count: 4,
    content_type: "text/html",
    truncated: false,
    extractor: "readability",
  });
});

test("researchQuery keeps per-result fetch failures in the source bundle", async () => {
  const result = await researchQuery("mixed fetch results", {
    limit: 2,
    search: async () => [
      { url: "https://example.com/ok", title: "OK" },
      { url: "https://example.com/missing", title: "Missing" },
    ],
    fetchUrl: async (url) => {
      if (url.endsWith("/missing")) throw new Error("HTTP status 404");
      return {
        res: new Response("ignored", { headers: { "content-type": "text/html" } }),
        finalUrl: url,
      };
    },
    readBytes: async () => encoder.encode("html"),
    extractContent: async () => ({
      title: "OK",
      content: "fetched content",
      wordCount: 2,
      contentType: "text/html",
      extractor: "readability",
    }),
  });

  assert.equal(result.fetched_count, 1);
  assert.equal(result.failed_count, 1);
  assert.equal(result.results[0].fetched, true);
  assert.equal(result.results[1].fetched, false);
  assert.deepEqual(result.results[1].error, {
    category: "http",
    message: "HTTP status 404",
  });
  assert.equal("content" in result.results[1], false);
});

test("researchQuery caps content per fetched source", async () => {
  const longContent = "a".repeat(4001);

  const result = await researchQuery("large source", {
    search: async () => [{ url: "https://example.com/large", title: "Large" }],
    fetchUrl: async (url) => ({
      res: new Response("ignored", { headers: { "content-type": "text/html" } }),
      finalUrl: url,
    }),
    readBytes: async () => encoder.encode("html"),
    extractContent: async () => ({
      title: "Large",
      content: longContent,
      wordCount: 1,
      contentType: "text/html",
      extractor: "readability",
    }),
  });

  assert.equal(result.results[0].content.length, 4000);
  assert.equal(result.results[0].truncated, true);
});
