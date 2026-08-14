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

test("registers only the two basic web tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["fetch_url", "web_search"],
  );

  const fetchTool = tools.find((tool) => tool.name === "fetch_url");
  const searchTool = tools.find((tool) => tool.name === "web_search");
  assert.ok(fetchTool);
  assert.ok(searchTool);
  assert.match(fetchTool.description, /PDF/);
  assert.match(fetchTool.description, /image/);
  assert.match(fetchTool.description, /Reddit/);
  assert.deepEqual(Object.keys(fetchTool.inputSchema.properties).sort(), [
    "max_length",
    "start_index",
    "url",
  ]);
  assert.deepEqual(Object.keys(searchTool.inputSchema.properties).sort(), ["limit", "query"]);
});

test("web_search rejects blank queries before calling SearXNG", async () => {
  const result = await client.callTool({
    name: "web_search",
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

test("fetch_url validates continuation bounds in its input schema", async () => {
  const negativeOffset = await client.callTool({
    name: "fetch_url",
    arguments: { url: "https://example.com", start_index: -1 },
  });
  assert.equal(negativeOffset.isError, true);

  const excessiveLength = await client.callTool({
    name: "fetch_url",
    arguments: { url: "https://example.com", max_length: 20001 },
  });
  assert.equal(excessiveLength.isError, true);
});

test("fetch_url rejects non-post Reddit URLs", async () => {
  const result = await client.callTool({
    name: "fetch_url",
    arguments: { url: "https://www.reddit.com/r/typescript/" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: URL must be a Reddit post URL/);
});
