import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SearchChainError } from "@yoloyash/web-basics";
import { createMcpServer } from "@yoloyash/web-basics/mcp";

test("fetch_url structured output validates for text and images", async () => {
  const webBasics = {
    async webSearch({ query }) {
      if (query === "failure") {
        throw new SearchChainError(
          [new Error("rate limited"), new Error("empty")],
          "All web search providers failed: brave: rate limited; firecrawl: empty",
          "firecrawl",
        );
      }
      return {
        provider: "exa",
        answer: "Example answer",
        sources: [{
          title: "Example",
          url: "https://example.com/",
          snippet: "Example snippet",
          publishedDate: "2026-08-25",
          ageSeconds: 60,
          author: "Example author",
        }],
        citations: [{
          title: "Example citation",
          url: "https://example.com/citation",
          citedText: "Cited text",
        }],
        searchQueries: ["example query"],
        relatedQuestions: ["Related question?"],
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          searchRequests: 1,
          totalTokens: 3,
        },
        model: "example-model",
        requestId: "request-id",
        authMode: "keyless",
      };
    },
    async fetchUrl({ url }) {
      if (url.endsWith("image.png")) {
        return {
          kind: "image",
          url,
          data: Uint8Array.from([1, 2, 3, 4]),
          byteLength: 4,
          contentType: "image/png",
          extractor: "image",
        };
      }
      return {
        kind: "text",
        url,
        title: "Example",
        content: "example content",
        wordCount: 2,
        contentType: "text/plain",
        extractor: "text",
        startIndex: 0,
        returnedChars: 15,
        totalChars: 15,
        truncated: false,
      };
    },
  };
  const server = createMcpServer(webBasics);
  const client = new Client({ name: "structured-output-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const text = await client.callTool({
      name: "fetch_url",
      arguments: { url: "https://example.com/page" },
    });
    assert.deepEqual(text.structuredContent, JSON.parse(text.content[0].text));

    const image = await client.callTool({
      name: "fetch_url",
      arguments: { url: "https://example.com/image.png" },
    });
    assert.deepEqual(image.structuredContent, JSON.parse(image.content[0].text));
    assert.deepEqual(image.content[1], {
      type: "image",
      data: "AQIDBA==",
      mimeType: "image/png",
    });

    const search = await client.callTool({
      name: "web_search",
      arguments: { query: "success" },
    });
    assert.equal(search.structuredContent.response.provider, "exa");
    assert.equal(search.structuredContent.response.requestId, "request-id");
    assert.equal(search.structuredContent.response.authMode, "keyless");
    assert.equal("attempts" in search.structuredContent.response, false);

    const failedSearch = await client.callTool({
      name: "web_search",
      arguments: { query: "failure" },
    });
    assert.equal(failedSearch.isError, undefined);
    assert.deepEqual(failedSearch.structuredContent, {
      response: { provider: "firecrawl", sources: [] },
      error: "All web search providers failed: brave: rate limited; firecrawl: empty",
    });
    assert.equal(
      failedSearch.content[0].text,
      "Error: All web search providers failed: brave: rate limited; firecrawl: empty",
    );
  } finally {
    await client.close();
    await server.close();
  }
});
