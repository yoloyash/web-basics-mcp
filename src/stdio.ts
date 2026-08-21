#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWebBasics, type SearchBackend } from "./api.js";
import { loadEnv } from "./lib/env.js";
import { createMcpServer } from "./server.js";

loadEnv();

const searchBackend = configuredSearchBackend(process.env.SEARCH_PROVIDER);
const webBasics = createWebBasics({
  braveApiKey: process.env.BRAVE_SEARCH_API_KEY,
  searchBackend,
  searxngUrl: process.env.SEARXNG_URL,
});
const server = createMcpServer(webBasics);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("web-basics running...");

function configuredSearchBackend(value: string | undefined): SearchBackend {
  const backend = value?.trim().toLowerCase() || "searxng";
  if (backend !== "brave" && backend !== "searxng") {
    throw new Error("SEARCH_PROVIDER must be either brave or searxng");
  }
  return backend;
}
