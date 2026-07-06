import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client;

before(async () => {
  client = new Client({ name: "web-basics-mcp-tests", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/index.js"],
  });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
});

test("registers the expected tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["fetch_url", "get_content", "reddit_fetch", "web_search"],
  );

  const fetchTool = tools.find((tool) => tool.name === "fetch_url");
  assert.ok(fetchTool);
  assert.match(fetchTool.description, /PDF/);
  assert.match(fetchTool.description, /images/);
});

test("web_search rejects blank queries before calling SearXNG", async () => {
  const result = await client.callTool({
    name: "web_search",
    arguments: { query: "   " },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Query cannot be empty/);
});

test("web_search rejects query and queries together", async () => {
  const result = await client.callTool({
    name: "web_search",
    arguments: {
      query: "typescript",
      queries: ["node"],
    },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Use either query or queries, not both/);
});

test("web_search rejects blank values in queries before calling SearXNG", async () => {
  const result = await client.callTool({
    name: "web_search",
    arguments: { queries: ["typescript", "   "] },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Query cannot be empty/);
});

test("fetch_url blocks localhost URLs", async () => {
  const result = await client.callTool({
    name: "fetch_url",
    arguments: { url: "http://localhost:8088" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Private hostnames not allowed/);
});

test("fetch_url rejects unsupported protocols", async () => {
  const result = await client.callTool({
    name: "fetch_url",
    arguments: { url: "ftp://example.com/file.txt" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Unsupported protocol/);
});

test("fetch_url rejects url and urls together", async () => {
  const result = await client.callTool({
    name: "fetch_url",
    arguments: {
      url: "https://example.com",
      urls: ["https://example.org"],
    },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Use either url or urls, not both/);
});

test("fetch_url batch returns per-url validation errors", async () => {
  const result = await client.callTool({
    name: "fetch_url",
    arguments: {
      urls: ["http://localhost:8088", "ftp://example.com/file.txt"],
    },
  });

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.fetchedCount, 0);
  assert.equal(payload.failedCount, 2);
  assert.deepEqual(
    payload.results.map((item) => item.inputUrl),
    ["http://localhost:8088", "ftp://example.com/file.txt"],
  );
  assert.deepEqual(
    payload.results.map((item) => item.error.category),
    ["validation", "validation"],
  );
});

test("get_content rejects unknown content ids", async () => {
  const result = await client.callTool({
    name: "get_content",
    arguments: { content_id: "missing" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Unknown or expired content_id/);
});

test("reddit_fetch rejects non-Reddit URLs", async () => {
  const result = await client.callTool({
    name: "reddit_fetch",
    arguments: { url: "https://example.com/r/typescript/comments/abc/title/" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Only Reddit post URLs are supported/);
});
