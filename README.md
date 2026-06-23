# web-basics-mcp

A self-hosted MCP server for web search and fetching. Runs entirely on your machine — no API keys, no accounts, no external calls.

## What it is

Runs as a local MCP server over stdio. It exposes two tools to your AI:

- **`web_search`** — Sends your query to a local SearXNG instance and returns a list of results (title, link, snippet).
- **`fetch_url`** — Fetches a webpage, strips it down to clean markdown, and returns the content.

The SearXNG backend runs in Docker by default, but you can point it at any existing SearXNG instance via the `SEARXNG_URL` env var. The fetch tool has SSRF protection — it validates domains, resolves IPs, and blocks any request to private or reserved ranges.

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```

2. Start the search backend (optional):
   ```bash
   docker compose up -d
   ```
   Starts a local SearXNG instance at `127.0.0.1:8088`. If you already have a SearXNG server, set the `SEARXNG_URL` env var instead.

3. Add to your MCP client config:
   ```json
   {
     "mcpServers": {
       "web-basics": {
         "command": "bun",
         "args": ["/path/to/web-basics-mcp/src/index.ts"]
       }
     }
   }
   ```


