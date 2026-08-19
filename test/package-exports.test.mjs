import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWebBasics,
  fetchUrl,
  webSearch,
} from "@yoloyash/web-basics";
import { createMcpServer } from "@yoloyash/web-basics/mcp";

test("exports a side-effect-free API and MCP server factory", () => {
  assert.equal(typeof createWebBasics, "function");
  assert.equal(typeof webSearch, "function");
  assert.equal(typeof fetchUrl, "function");
  assert.equal(typeof createMcpServer, "function");
});

test("rejects a pre-aborted fetch without starting network work", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => fetchUrl({ url: "https://example.com", signal: controller.signal }),
    { name: "AbortError" },
  );
});
