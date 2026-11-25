import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createKeenableSearchProvider,
  createWebBasics,
} from "@yoloyash/web-basics";
import { classifyError } from "../build/lib/errors.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("maps keyed Keenable search results onto the public search contract", async () => {
  const requests = [];
  const provider = createKeenableSearchProvider({
    apiKey: "  keen_test_key  ",
  }, {
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init, body: JSON.parse(init.body) });
      return jsonResponse({
        results: [
          {
            url: "https://example.com/result",
            title: "Example result",
            snippet: "Example snippet",
            published_at: "2026-11-24T10:00:00Z",
          },
          {
            url: "https://example.com/fallback",
            description: "Description snippet",
          },
        ],
      }, { "x-request-id": "req-123" });
    },
    lookupHost: publicLookup,
  });

  const response = await provider.search({
    query: "keenable integration query",
    limit: 2,
    recency: "week",
  });

  assert.deepEqual(response, {
    provider: "keenable",
    authMode: "api_key",
    requestId: "req-123",
    sources: [
      {
        url: "https://example.com/result",
        title: "Example result",
        snippet: "Example snippet",
        publishedDate: "2026-11-24T10:00:00Z",
      },
      {
        url: "https://example.com/fallback",
        title: "https://example.com/fallback",
        snippet: "Description snippet",
      },
    ],
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.origin, "https://api.keenable.ai");
  assert.equal(requests[0].url.pathname, "/v1/search");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.Accept, "application/json");
  assert.equal(requests[0].init.headers["Content-Type"], "application/json");
  assert.equal(requests[0].init.headers["X-API-Key"], "keen_test_key");
  assert.equal(requests[0].init.headers["X-Keenable-Title"], undefined);
  assert.deepEqual(requests[0].body, {
    max_results: 2,
    published_after: "7d",
    query: "keenable integration query",
  });
});

test("uses the public endpoint and X-Keenable-Title when no API key is set", async () => {
  const requests = [];
  const provider = createKeenableSearchProvider({
    clientTitle: "OvertChat",
  }, {
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init, body: JSON.parse(init.body) });
      return jsonResponse({ results: [] });
    },
    lookupHost: publicLookup,
  });

  const response = await provider.search({
    query: "public keenable query",
    limit: 3,
  });

  assert.deepEqual(response, {
    provider: "keenable",
    authMode: "keyless",
    sources: [],
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.origin, "https://api.keenable.ai");
  assert.equal(requests[0].url.pathname, "/v1/search/public");
  assert.equal(requests[0].init.headers["X-Keenable-Title"], "OvertChat");
  assert.equal(requests[0].init.headers["X-API-Key"], undefined);
  assert.deepEqual(requests[0].body, {
    max_results: 3,
    query: "public keenable query",
  });
});

test("coalesces concurrent Keenable searches without caching completed results", async () => {
  let calls = 0;
  let releaseRequest;
  let markRequestStarted;
  const requestGate = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  const requestStarted = new Promise((resolve) => {
    markRequestStarted = resolve;
  });
  const provider = createKeenableSearchProvider({}, {
    fetchImpl: async () => {
      calls += 1;
      markRequestStarted();
      await requestGate;
      return jsonResponse({ results: [] });
    },
    lookupHost: publicLookup,
  });

  const first = provider.search({ query: "same query" });
  const second = provider.search({ query: "same query" });
  await requestStarted;
  assert.equal(calls, 1);
  releaseRequest();
  await Promise.all([first, second]);

  await provider.search({ query: "same query" });
  assert.equal(calls, 2);
});

test("does not follow redirects with Keenable credentials", async () => {
  let calls = 0;
  const provider = createKeenableSearchProvider({
    apiKey: "keen_secret",
  }, {
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, {
        headers: { location: "https://redirect.example/collect" },
        status: 302,
      });
    },
    lookupHost: publicLookup,
  });

  await assert.rejects(() => provider.search({ query: "redirect query" }), /Too many redirects/);
  assert.equal(calls, 1);
});

test("retries Keenable rate limits once using Retry-After capped at 2 seconds", async () => {
  let calls = 0;
  const delays = [];
  const provider = createKeenableSearchProvider({
    apiKey: "keen_test",
  }, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          headers: { "retry-after": "5" },
          status: 429,
        });
      }
      return jsonResponse({ results: [] });
    },
    lookupHost: publicLookup,
    wait: async (delayMs) => delays.push(delayMs),
  });

  assert.deepEqual(await provider.search({ query: "rate limit query" }), {
    provider: "keenable",
    authMode: "api_key",
    sources: [],
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2_000]);
});

test("surfaces exhausted Keenable rate limits as retryable HTTP errors", async () => {
  let calls = 0;
  const provider = createKeenableSearchProvider({}, {
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", {
        headers: { "retry-after": "1" },
        status: 429,
      });
    },
    lookupHost: publicLookup,
    wait: async () => {},
  });

  await assert.rejects(() => provider.search({ query: "exhausted rate limit" }), (error) => {
    assert.equal(classifyError(error).category, "http");
    assert.equal(classifyError(error).retryable, true);
    return true;
  });
  assert.equal(calls, 2);
});

test("rejects malformed and non-JSON Keenable responses", async () => {
  const malformed = createKeenableSearchProvider({}, {
    fetchImpl: async () => new Response("{", {
      headers: { "content-type": "application/json" },
    }),
    lookupHost: publicLookup,
  });
  const html = createKeenableSearchProvider({}, {
    fetchImpl: async () => new Response("<html></html>", {
      headers: { "content-type": "text/html" },
    }),
    lookupHost: publicLookup,
  });

  await assert.rejects(() => malformed.search({ query: "malformed query" }), /Failed to parse Keenable Search response/);
  await assert.rejects(() => html.search({ query: "html query" }), /Unsupported content-type from Keenable: text\/html/);
});

test("constructs explicit keenable backend with or without an API key", () => {
  assert.doesNotThrow(() => createWebBasics({ searchBackend: "keenable" }));
  assert.doesNotThrow(() => createWebBasics({
    searchBackend: "keenable",
    keenableApiKey: "keen_test",
  }));
});

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", ...headers },
  });
}
