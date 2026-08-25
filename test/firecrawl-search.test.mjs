import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirecrawlSearchProvider } from "@yoloyash/web-basics";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("maps keyless Firecrawl web results onto the public contract", async () => {
  let request;
  const provider = createFirecrawlSearchProvider({
    fetchImpl: async (url, init) => {
      request = { url: new URL(url), init };
      return jsonResponse({
        success: true,
        data: {
          web: [
            {
              url: "https://example.com/result#section",
              title: " Example result ",
              description: " Example   snippet ",
            },
            { url: "javascript:alert(1)", title: "Unsafe" },
          ],
        },
      });
    },
    lookupHost: publicLookup,
  });

  assert.deepEqual(await provider("firecrawl query"), [
    {
      link: "https://example.com/result",
      title: "Example result",
      snippet: "Example snippet",
    },
  ]);
  assert.equal(request.url.toString(), "https://api.firecrawl.dev/v2/search");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.redirect, "manual");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(request.init.body), {
    limit: 10,
    query: "firecrawl query",
    sources: [{ type: "web" }],
  });
});

test("coalesces concurrent Firecrawl searches without retaining results", async () => {
  let calls = 0;
  let releaseRequest;
  let markRequestStarted;
  const requestGate = new Promise((resolve) => { releaseRequest = resolve; });
  const requestStarted = new Promise((resolve) => { markRequestStarted = resolve; });
  const provider = createFirecrawlSearchProvider({
    fetchImpl: async () => {
      calls += 1;
      markRequestStarted();
      await requestGate;
      return jsonResponse({ success: true, data: { web: [] } });
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

test("surfaces Firecrawl application errors", async () => {
  const provider = createFirecrawlSearchProvider({
    fetchImpl: async () => jsonResponse({ success: false, error: "quota exhausted" }),
    lookupHost: publicLookup,
  });

  await assert.rejects(() => provider("failed query"), /quota exhausted/);
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
