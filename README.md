# web-basics-mcp

A standalone, zero-configuration Model Context Protocol (MCP) server that provides fundamental web capabilities:
- **`web_search`**: Privacy-respecting web search powered by a local SearXNG instance.
- **`fetch_url`**: Safely fetches and distills web pages into clean Markdown, featuring SSRF mitigation, size caps, and fast native parsing.

## 2026 Native Standard
This server is built to execute purely natively via **Bun**. It contains zero Node.js compilation bloat.

## Setup

1. **Install Dependencies:**
   ```bash
   bun install
   ```

2. **Start the Search Backend (Optional):**
   If you don't already have a SearXNG instance running in your environment, use the provided compose file to spin up an optimized, local search engine:
   ```bash
   docker compose up -d
   ```
   *(This starts a local SearXNG at `http://127.0.0.1:8088` which the MCP server defaults to. It is only exposed to localhost.)*

3. **Configure Your MCP Client:**
   Add the following to your AI editor (Cursor, Claude Desktop, Overtchat, etc.):
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
