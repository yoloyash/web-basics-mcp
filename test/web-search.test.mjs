import assert from "node:assert/strict";
import { test } from "node:test";
import { searchSingleQuery } from "../build/tools/web-search.js";

test("caches identical SearXNG searches", async () => {
  const originalFetch = globalThis.fetch;
  const originalSearxngUrl = process.env.SEARXNG_URL;
  let calls = 0;
  process.env.SEARXNG_URL = "https://search-cache.example";
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        results: [
          { url: "https://example.com/first" },
          { url: "https://example.com/second" },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  };

  try {
    const first = await searchSingleQuery("cache integration query", 1);
    const second = await searchSingleQuery("cache integration query", 2);

    assert.equal(calls, 1);
    assert.equal(first.length, 1);
    assert.equal(second.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSearxngUrl === undefined) delete process.env.SEARXNG_URL;
    else process.env.SEARXNG_URL = originalSearxngUrl;
  }
});

test("searchSingleQuery normalizes, limits, and formats results", async () => {
  const seenQueries = [];
  const results = await searchSingleQuery(" typescript ", 1, async (query) => {
    seenQueries.push(query);
    return [
      { url: "https://example.com/a", title: "A", content: "Alpha" },
      { url: "https://example.com/b", title: "B", content: "Beta" },
    ];
  });

  assert.deepEqual(seenQueries, ["typescript"]);
  assert.deepEqual(results, [{ link: "https://example.com/a", title: "A", snippet: "Alpha" }]);
});

test("searchSingleQuery rejects invalid queries before searching", async () => {
  let called = false;
  await assert.rejects(
    () =>
      searchSingleQuery("   ", 5, async () => {
        called = true;
        return [];
      }),
    /Query cannot be empty/,
  );
  assert.equal(called, false);
});
