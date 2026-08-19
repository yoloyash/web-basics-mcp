#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWebBasics } from "./api.js";
import { loadEnv } from "./lib/env.js";
import { createMcpServer } from "./server.js";

loadEnv();

const webBasics = createWebBasics({ searxngUrl: process.env.SEARXNG_URL });
const server = createMcpServer(webBasics);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("web-basics running...");
