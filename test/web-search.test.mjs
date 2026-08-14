import assert from "node:assert/strict";
import { test } from "node:test";
import { searchSingleQuery } from "../build/tools/web-search.js";

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
