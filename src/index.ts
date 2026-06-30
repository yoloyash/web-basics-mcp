#!/usr/bin/env node
import "dotenv/config";
import { initProxy } from "./lib/proxy.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

initProxy();

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("web-basics-mcp running...");
