import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWebBasics,
  SearchChainError,
  SearchProviderError,
  webSearch,
} from "@yoloyash/web-basics";

test("tries providers sequentially and returns only the successful response", async () => {
  const calls = [];
  const providers = [
    testProvider("brave", async (params) => {
      calls.push(["brave", params.limit]);
      throw new SearchProviderError("brave", "rate limited", 429);
    }),
    testProvider("searxng", async (params) => {
      calls.push(["searxng", params.limit]);
      return { provider: "searxng", sources: [] };
    }),
    testProvider("firecrawl", async (params) => {
      calls.push(["firecrawl", params.limit]);
      return {
        provider: "firecrawl",
        authMode: "keyless",
        sources: [{ url: "https://example.com/", title: "Example", snippet: "Result" }],
      };
    }),
    testProvider("exa", async () => {
      calls.push(["exa", undefined]);
      return { provider: "exa", sources: [] };
    }),
  ];

  assert.deepEqual(await webSearch({ query: "fallback query", limit: 2 }, providers), {
    provider: "firecrawl",
    authMode: "keyless",
    sources: [{ url: "https://example.com/", title: "Example", snippet: "Result" }],
  });
  assert.deepEqual(calls, [["brave", 2], ["searxng", 2], ["firecrawl", 2]]);
});

test("treats an empty response as a provider failure and reports the failed chain", async () => {
  const providers = [
    testProvider("brave", async () => {
      throw new SearchProviderError("brave", "rate limited", 429);
    }),
    testProvider("searxng", async () => ({ provider: "searxng", sources: [] })),
  ];

  await assert.rejects(
    () => webSearch({ query: "no matches" }, providers),
    (error) => {
      assert.ok(error instanceof SearchChainError);
      assert.equal(error.provider, "searxng");
      assert.match(error.message, /brave: rate limited/);
      assert.match(error.message, /searxng: SearXNG returned no renderable search content/);
      return true;
    },
  );
});

test("skips unavailable automatic candidates", async () => {
  let unavailableCalled = false;
  const response = await webSearch({ query: "available" }, [
    testProvider("brave", async () => {
      unavailableCalled = true;
      return { provider: "brave", sources: [] };
    }, false),
    testProvider("duckduckgo", async () => ({
      provider: "duckduckgo",
      sources: [{ url: "https://example.com/", title: "Example" }],
    })),
  ]);

  assert.equal(unavailableCalled, false);
  assert.equal(response.provider, "duckduckgo");
});

test("does not fall through after caller cancellation", async () => {
  const controller = new AbortController();
  let fallbackCalled = false;
  const providers = [
    testProvider("brave", async () => {
      controller.abort();
      throw new Error("request aborted");
    }),
    testProvider("searxng", async () => {
      fallbackCalled = true;
      return { provider: "searxng", sources: [] };
    }),
  ];

  await assert.rejects(
    () => webSearch({ query: "cancelled query", signal: controller.signal }, providers),
    { name: "AbortError" },
  );
  assert.equal(fallbackCalled, false);
});

test("requires configured providers or keyless permission for automatic search", () => {
  assert.throws(
    () => createWebBasics({ searchBackend: "auto" }),
    /requires braveApiKey or searxngUrl unless allowKeylessFallback is enabled/,
  );
  assert.doesNotThrow(() => createWebBasics({
    allowKeylessFallback: true,
    searchBackend: "auto",
  }));
  assert.doesNotThrow(() => createWebBasics({
    braveApiKey: "test-token",
    searchBackend: "auto",
  }));
  assert.doesNotThrow(() => createWebBasics({
    searchBackend: "auto",
    searxngUrl: "https://search.example",
  }));
});

test("constructs explicit keyless backends without automatic permission", () => {
  for (const searchBackend of ["firecrawl", "exa", "duckduckgo"]) {
    assert.doesNotThrow(() => createWebBasics({ searchBackend }));
  }
});

function testProvider(id, search, available = true) {
  const label = id === "searxng" ? "SearXNG" : `${id[0].toUpperCase()}${id.slice(1)}`;
  return {
    id,
    label,
    isAvailable: () => available,
    isExplicitlyAvailable: () => available,
    search,
  };
}
