import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client;
let searchServer;
const { version: packageVersion } = createRequire(import.meta.url)("../package.json");

before(async () => {
  searchServer = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      results: [
        {
          url: "https://example.com/result",
          title: "Example result",
          content: "Example snippet",
        },
      ],
    }));
  });
  await new Promise((resolve) => searchServer.listen(0, "127.0.0.1", resolve));
  const address = searchServer.address();
  assert.ok(address && typeof address === "object");

  client = new Client({ name: "web-basics-mcp-tests", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/stdio.js"],
    env: {
      ...stringEnvironment(process.env),
      SEARCH_PROVIDER: "searxng",
      SEARXNG_URL: `http://127.0.0.1:${address.port}`,
    },
  });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  if (searchServer) {
    await new Promise((resolve, reject) => {
      searchServer.close((error) => error ? reject(error) : resolve());
    });
  }
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
  assert.equal(fetchTool.outputSchema.type, "object");
  assert.equal(searchTool.outputSchema.type, "object");
  assert.ok(fetchTool.outputSchema.properties.url);
  assert.ok(searchTool.outputSchema.properties.results);
  assert.deepEqual(fetchTool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(searchTool.annotations, fetchTool.annotations);
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

test("reports the installed package version through MCP", () => {
  assert.equal(client.getServerVersion()?.version, packageVersion);
});

test("web_search rejects blank queries before calling SearXNG", async () => {
  const result = await client.callTool({
    name: "web_search",
    arguments: { query: "   " },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^validation: Query cannot be empty/);
});

test("web_search returns structured MCP results and compatible text", async () => {
  const result = await client.callTool({
    name: "web_search",
    arguments: { query: "structured output" },
  });

  assert.deepEqual(result.structuredContent, {
    results: [
      {
        link: "https://example.com/result",
        title: "Example result",
        snippet: "Example snippet",
      },
    ],
  });
  assert.deepEqual(
    JSON.parse(result.content[0].text),
    result.structuredContent.results,
  );
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

function stringEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter((entry) => typeof entry[1] === "string"),
  );
}
