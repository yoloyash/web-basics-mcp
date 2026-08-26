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
    assert.equal(first.sources.length, 1);
    assert.equal(second.sources.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps SearXNG answers and suggestions onto the unified response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    answers: ["Direct answer"],
    suggestions: ["Related question?"],
    results: [],
  }), { headers: { "content-type": "application/json" } });

  try {
    const response = await webSearch(
      { query: "searxng answer metadata" },
      createSearxngSearchProvider("https://search-answer.example"),
    );
    assert.deepEqual(response, {
      provider: "searxng",
      answer: "Direct answer",
      sources: [],
      relatedQuestions: ["Related question?"],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("webSearch normalizes, limits, and formats results", async () => {
  const seenQueries = [];
  const seenLimits = [];
  const results = await webSearch(
    { query: " typescript ", limit: 1 },
    testProvider("duckduckgo", async (params) => {
      seenQueries.push(params.query);
      seenLimits.push(params.limit);
      return {
        provider: "duckduckgo",
        sources: [{ url: "https://example.com/a", title: "A", snippet: "Alpha" }],
      };
    }),
  );

  assert.deepEqual(seenQueries, ["typescript"]);
  assert.deepEqual(seenLimits, [1]);
  assert.deepEqual(results, {
    provider: "duckduckgo",
    sources: [{ url: "https://example.com/a", title: "A", snippet: "Alpha" }],
  });
});

test("webSearch rejects invalid queries before searching", async () => {
  let called = false;
  await assert.rejects(
    () =>
      webSearch({ query: "   " }, testProvider("duckduckgo", async () => {
        called = true;
        return { provider: "duckduckgo", sources: [] };
      })),
    /Query cannot be empty/,
  );
  assert.equal(called, false);
});

test("webSearch forwards AbortSignal to the configured provider", async () => {
  const controller = new AbortController();
  let seenSignal;

  await webSearch(
    { query: "typescript", signal: controller.signal },
    testProvider("duckduckgo", async (params) => {
      seenSignal = params.signal;
      return {
        provider: "duckduckgo",
        sources: [{ url: "https://example.com/", title: "Example" }],
      };
    }),
  );

  assert.equal(seenSignal, controller.signal);
});

function testProvider(id, search) {
  return {
    id,
    label: "Test",
    isAvailable: () => true,
    isExplicitlyAvailable: () => true,
    search,
  };
}
