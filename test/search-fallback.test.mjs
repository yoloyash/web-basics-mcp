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
      search: async () => {
        calls.push("first");
        throw new Error("unavailable");
      },
    },
    {
      name: "second",
      search: async () => {
        calls.push("second");
        return [];
      },
    },
    {
      name: "third",
      search: async () => {
        calls.push("third");
        return [{ link: "https://example.com/", title: "Example", snippet: "Result" }];
      },
    },
    {
      name: "unused",
      search: async () => {
        calls.push("unused");
        return [];
      },
    },
  ]);

  assert.deepEqual(await provider("fallback query"), [
    { link: "https://example.com/", title: "Example", snippet: "Result" },
  ]);
  assert.deepEqual(calls, ["first", "second", "third"]);
});

test("returns an empty result when at least one provider completed successfully", async () => {
  const provider = createFallbackSearchProvider([
    { name: "failed", search: async () => { throw new Error("offline"); } },
    { name: "empty", search: async () => [] },
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
