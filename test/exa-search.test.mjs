import assert from "node:assert/strict";
import { test } from "node:test";
import { createExaSearchProvider } from "@yoloyash/web-basics";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("maps anonymous Exa MCP text results onto the public contract", async () => {
  let request;
  const provider = createExaSearchProvider({
    fetchImpl: async (url, init) => {
      request = { url: new URL(url), init };
      return sseResponse({
        jsonrpc: "2.0",
        id: "web-basics-search",
        result: {
          content: [{
            type: "text",
            text: [
              "Title: First result",
              "URL: https://example.com/first",
              "Published: N/A",
              "Highlights:",
              "Useful first highlight.",
              "",
              "---",
              "",
              "Title: Second result",
              "URL: https://example.com/second",
              "Highlights:",
              "Useful second highlight.",
            ].join("\n"),
          }],
        },
      });
    },
    lookupHost: publicLookup,
  });

  assert.deepEqual(await provider.search({ query: "exa query", limit: 4 }), {
    provider: "exa",
    sources: [
      {
        url: "https://example.com/first",
        title: "First result",
        snippet: "Useful first highlight.",
      },
      {
        url: "https://example.com/second",
        title: "Second result",
        snippet: "Useful second highlight.",
      },
    ],
  });
  assert.equal(request.url.origin, "https://mcp.exa.ai");
  assert.equal(request.url.searchParams.get("tools"), "web_search_exa");
  assert.equal(request.init.headers["x-exa-source"], "web-basics");
  assert.deepEqual(JSON.parse(request.init.body).params, {
    arguments: { numResults: 4, query: "exa query" },
    name: "web_search_exa",
  });
});

test("accepts structured Exa MCP results", async () => {
  const provider = createExaSearchProvider({
    fetchImpl: async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      result: {
        structuredContent: {
          results: [{
            url: "https://example.com/structured",
            title: "Structured",
            highlights: ["One", "Two"],
          }],
        },
      },
    }), { headers: { "content-type": "application/json" } }),
    lookupHost: publicLookup,
  });

  assert.deepEqual(await provider.search({ query: "structured query" }), {
    provider: "exa",
    sources: [{
      url: "https://example.com/structured",
      title: "Structured",
      snippet: "One Two",
    }],
  });
});

test("surfaces Exa MCP tool errors", async () => {
  const provider = createExaSearchProvider({
    fetchImpl: async () => sseResponse({
      jsonrpc: "2.0",
      result: {
        isError: true,
        content: [{ type: "text", text: "anonymous rate limit reached" }],
      },
    }),
    lookupHost: publicLookup,
  });

  await assert.rejects(
    () => provider.search({ query: "failed query" }),
    /anonymous rate limit reached/,
  );
});

function sseResponse(value) {
  return new Response(`event: message\ndata: ${JSON.stringify(value)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}
