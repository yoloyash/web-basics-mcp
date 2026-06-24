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
    ["fetch_url", "reddit_fetch", "reddit_search", "web_search"],
  );

  const fetchTool = tools.find((tool) => tool.name === "fetch_url");
  assert.ok(fetchTool);
  assert.match(fetchTool.description, /PDF/);
});

test("web_search rejects blank queries before calling SearXNG", async () => {
  const result = await client.callTool({
    name: "web_search",
    arguments: { query: "   " },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Query cannot be empty/);
});

test("reddit_search validates subreddit names", async () => {
  const result = await client.callTool({
    name: "reddit_search",
    arguments: { query: "typescript", subreddit: "bad/subreddit" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Invalid subreddit/);
});

test("reddit_search rejects blank queries before calling SearXNG", async () => {
  const result = await client.callTool({
    name: "reddit_search",
    arguments: { query: "   " },
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

test("reddit_fetch rejects non-Reddit URLs", async () => {
  const result = await client.callTool({
    name: "reddit_fetch",
    arguments: { url: "https://example.com/r/typescript/comments/abc/title/" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Only Reddit post URLs are supported/);
});
