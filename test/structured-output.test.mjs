import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@yoloyash/web-basics/mcp";

test("fetch_url structured output validates for text and images", async () => {
  const webBasics = {
    async webSearch() {
      return [];
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
  } finally {
    await client.close();
    await server.close();
  }
});
