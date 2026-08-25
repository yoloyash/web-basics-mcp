import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFallbackSearchProvider,
  createWebBasics,
} from "@yoloyash/web-basics";

test("tries providers sequentially until one returns results", async () => {
  const calls = [];
  const provider = createFallbackSearchProvider([
    {
      name: "first",
      search: async (_query, _signal, limit) => {
        calls.push(["first", limit]);
        throw new Error("unavailable");
      },
    },
    {
      name: "second",
      search: async (_query, _signal, limit) => {
        calls.push(["second", limit]);
        return [];
      },
    },
    {
      name: "third",
      search: async (_query, _signal, limit) => {
        calls.push(["third", limit]);
        return [{ link: "https://example.com/", title: "Example", snippet: "Result" }];
      },
    },
    {
      name: "unused",
      search: async () => {
        calls.push(["unused", undefined]);
        return [];
      },
    },
  ]);

  assert.deepEqual(await provider("fallback query", undefined, 2), [
    { link: "https://example.com/", title: "Example", snippet: "Result" },
  ]);
  assert.deepEqual(calls, [["first", 2], ["second", 2], ["third", 2]]);
});

test("does not hide provider failures behind an empty result", async () => {
  const provider = createFallbackSearchProvider([
    { name: "failed", search: async () => { throw new Error("offline"); } },
    { name: "empty", search: async () => [] },
  ]);

  await assert.rejects(
    () => provider("no matches"),
    /No search provider returned results: failed: offline; empty: returned no results/,
  );
});

test("returns an empty result when every provider completed without results", async () => {
  const provider = createFallbackSearchProvider([
    { name: "first", search: async () => [] },
    { name: "second", search: async () => [] },
  ]);

  assert.deepEqual(await provider("no matches"), []);
});

test("reports every provider when the complete chain fails", async () => {
  const provider = createFallbackSearchProvider([
    { name: "brave", search: async () => { throw new Error("rate limited"); } },
    { name: "searxng", search: async () => { throw new Error("offline"); } },
  ]);

  await assert.rejects(
    () => provider("failed query"),
    /All search providers failed: brave: rate limited; searxng: offline/,
  );
});

test("does not fall through after caller cancellation", async () => {
  const controller = new AbortController();
  let fallbackCalled = false;
  const provider = createFallbackSearchProvider([
    {
      name: "active",
      search: async () => {
        controller.abort();
        throw new Error("request aborted");
      },
    },
    {
      name: "fallback",
      search: async () => {
        fallbackCalled = true;
        return [];
      },
    },
  ]);

  await assert.rejects(
    () => provider("cancelled query", controller.signal),
    { name: "AbortError" },
  );
  assert.equal(fallbackCalled, false);
});

test("rejects an empty provider chain", () => {
  assert.throws(
    () => createFallbackSearchProvider([]),
    /At least one search provider is required/,
  );
});

test("constructs auto and explicit keyless backends without credentials", () => {
  for (const searchBackend of ["auto", "firecrawl", "exa", "duckduckgo"]) {
    assert.doesNotThrow(() => createWebBasics({ searchBackend }));
  }
});
