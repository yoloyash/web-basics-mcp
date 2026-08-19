import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSearxngSearchProvider,
  createWebBasics,
  webSearch,
} from "@yoloyash/web-basics";

test("caches identical SearXNG searches", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
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
    const web = createWebBasics({
      searchProvider: createSearxngSearchProvider("https://search-cache.example"),
    });
    const first = await web.webSearch({ query: "cache integration query", limit: 1 });
    const second = await web.webSearch({ query: "cache integration query", limit: 2 });

    assert.equal(calls, 1);
    assert.equal(first.length, 1);
    assert.equal(second.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("webSearch normalizes, limits, and formats results", async () => {
  const seenQueries = [];
  const results = await webSearch(
    { query: " typescript ", limit: 1 },
    async (query) => {
      seenQueries.push(query);
      return [
        { link: "https://example.com/a", title: "A", snippet: "Alpha" },
        { link: "https://example.com/b", title: "B", snippet: "Beta" },
      ];
    },
  );

  assert.deepEqual(seenQueries, ["typescript"]);
  assert.deepEqual(results, [
    { link: "https://example.com/a", title: "A", snippet: "Alpha" },
  ]);
});

test("webSearch rejects invalid queries before searching", async () => {
  let called = false;
  await assert.rejects(
    () =>
      webSearch({ query: "   " }, async () => {
        called = true;
        return [];
      }),
    /Query cannot be empty/,
  );
  assert.equal(called, false);
});

test("webSearch forwards AbortSignal to the configured provider", async () => {
  const controller = new AbortController();
  let seenSignal;

  await webSearch(
    { query: "typescript", signal: controller.signal },
    async (_query, signal) => {
      seenSignal = signal;
      return [];
    },
  );

  assert.equal(seenSignal, controller.signal);
});
