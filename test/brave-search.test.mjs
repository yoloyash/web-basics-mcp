import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBraveSearchProvider,
  createWebBasics,
} from "@yoloyash/web-basics";
import { classifyError } from "../build/lib/errors.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("maps Brave web results onto the public search contract", async () => {
  const requests = [];
  const provider = createBraveSearchProvider("  test-token  ", {
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init });
      return jsonResponse({
        web: {
          results: [
            {
              url: "https://example.com/result",
              title: "Example result",
              description: "Example snippet",
            },
            { url: "https://example.com/fallbacks" },
          ],
        },
      });
    },
    lookupHost: publicLookup,
  });

  const results = await provider("brave integration query");

  assert.deepEqual(results, [
    {
      link: "https://example.com/result",
      title: "Example result",
      snippet: "Example snippet",
    },
    {
      link: "https://example.com/fallbacks",
      title: "https://example.com/fallbacks",
      snippet: "",
    },
  ]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.origin, "https://api.search.brave.com");
  assert.equal(requests[0].url.pathname, "/res/v1/web/search");
  assert.equal(requests[0].url.searchParams.get("q"), "brave integration query");
  assert.equal(requests[0].url.searchParams.get("count"), "10");
  assert.equal(requests[0].url.searchParams.get("result_filter"), "web");
  assert.equal(requests[0].url.searchParams.get("safesearch"), "moderate");
  assert.equal(requests[0].url.searchParams.get("text_decorations"), "false");
  assert.equal(requests[0].init.headers.Accept, "application/json");
  assert.equal(requests[0].init.headers["Api-Version"], "2023-01-01");
  assert.equal(requests[0].init.headers["X-Subscription-Token"], "test-token");
});

test("coalesces concurrent Brave searches without caching completed results", async () => {
  let calls = 0;
  let releaseRequest;
  let markRequestStarted;
  const requestGate = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  const requestStarted = new Promise((resolve) => {
    markRequestStarted = resolve;
  });
  const provider = createBraveSearchProvider("test-token", {
    fetchImpl: async () => {
      calls += 1;
      markRequestStarted();
      await requestGate;
      return jsonResponse({ web: { results: [] } });
    },
    lookupHost: publicLookup,
  });

  const first = provider("same query");
  const second = provider("same query");
  await requestStarted;
  assert.equal(calls, 1);
  releaseRequest();
  await Promise.all([first, second]);

  await provider("same query");
  assert.equal(calls, 2);
});

test("requires a Brave API key when the Brave backend is selected", () => {
  assert.throws(
    () => createWebBasics({ searchBackend: "brave" }),
    /braveApiKey is required for Brave Search/,
  );
});

test("rejects unsupported configured search backends", () => {
  assert.throws(
    () => createWebBasics({ searchBackend: "unknown" }),
    /Unsupported search backend: unknown/,
  );
});

test("rejects queries outside Brave limits before fetching", async () => {
  let calls = 0;
  const provider = createBraveSearchProvider("test-token", {
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ web: { results: [] } });
    },
    lookupHost: publicLookup,
  });

  await assert.rejects(() => provider("x".repeat(401)), /cannot exceed 400 characters/);
  await assert.rejects(
    () => provider(Array.from({ length: 51 }, () => "word").join(" ")),
    /cannot exceed 50 words/,
  );
  assert.equal(calls, 0);
});

test("does not follow redirects with the Brave credential", async () => {
  let calls = 0;
  const provider = createBraveSearchProvider("test-token", {
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, {
        headers: { location: "https://redirect.example/collect" },
        status: 302,
      });
    },
    lookupHost: publicLookup,
  });

  await assert.rejects(() => provider("redirect query"), /Too many redirects/);
  assert.equal(calls, 1);
});

test("retries Brave rate limits once using the shortest reset window", async () => {
  let calls = 0;
  const delays = [];
  const provider = createBraveSearchProvider("test-token", {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          headers: { "x-ratelimit-reset": "1, 1200" },
          status: 429,
        });
      }
      return jsonResponse({ web: { results: [] } });
    },
    lookupHost: publicLookup,
    wait: async (delayMs) => delays.push(delayMs),
  });

  assert.deepEqual(await provider("rate limit query"), []);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1_000]);
});

test("caps Brave retry delays and surfaces an exhausted rate limit", async () => {
  let calls = 0;
  const delays = [];
  const provider = createBraveSearchProvider("test-token", {
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", {
        headers: { "x-ratelimit-reset": "3600" },
        status: 429,
      });
    },
    lookupHost: publicLookup,
    wait: async (delayMs) => delays.push(delayMs),
  });

  await assert.rejects(() => provider("exhausted rate limit query"), (error) => {
    assert.equal(classifyError(error).category, "http");
    assert.equal(classifyError(error).retryable, true);
    return true;
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2_000]);
});

test("rejects malformed and non-JSON Brave responses", async () => {
  const malformed = createBraveSearchProvider("test-token", {
    fetchImpl: async () => new Response("{", {
      headers: { "content-type": "application/json" },
    }),
    lookupHost: publicLookup,
  });
  const html = createBraveSearchProvider("test-token", {
    fetchImpl: async () => new Response("<html></html>", {
      headers: { "content-type": "text/html" },
    }),
    lookupHost: publicLookup,
  });

  await assert.rejects(() => malformed("malformed query"), /Failed to parse Brave Search response/);
  await assert.rejects(() => html("html query"), /Unsupported content-type: text\/html/);
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
