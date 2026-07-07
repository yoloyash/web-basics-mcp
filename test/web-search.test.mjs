import assert from "node:assert/strict";
import { test } from "node:test";
import { searchBatchQueries, searchSingleQuery } from "../build/tools/web-search.js";

test("searchSingleQuery normalizes before searching", async () => {
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

test("searchBatchQueries keeps successes when one query fails and runs sequentially", async () => {
  const seenQueries = [];
  let activeSearches = 0;
  let maxActiveSearches = 0;
  const payload = await searchBatchQueries([" typescript ", "broken"], 5, async (query) => {
    seenQueries.push(query);
    activeSearches += 1;
    maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
    try {
      if (query === "broken") throw new Error("HTTP status 429 from SearXNG");
      await Promise.resolve();
      return [{ url: "https://example.com/typescript", title: "TypeScript", content: "Docs" }];
    } finally {
      activeSearches -= 1;
    }
  });

  assert.deepEqual(seenQueries, ["typescript", "broken"]);
  assert.equal(maxActiveSearches, 1);
  assert.equal(payload.searchedCount, 1);
  assert.equal(payload.failedCount, 1);
  assert.deepEqual(payload.results[0], {
    query: "typescript",
    ok: true,
    results: [{ link: "https://example.com/typescript", title: "TypeScript", snippet: "Docs" }],
  });
  assert.equal(payload.results[1].query, "broken");
  assert.equal(payload.results[1].ok, false);
  assert.deepEqual(payload.results[1].error, {
    category: "http",
    message: "HTTP status 429 from SearXNG",
    retryable: true,
  });
});

test("searchBatchQueries rejects invalid queries before searching", async () => {
  let called = false;

  await assert.rejects(
    () =>
      searchBatchQueries(["valid", "   "], 5, async () => {
        called = true;
        return [];
      }),
    /Query cannot be empty/,
  );
  assert.equal(called, false);
});
