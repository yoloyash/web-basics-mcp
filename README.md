# web-basics-mcp

A self-hosted MCP server for web search and fetching. Runs entirely on your machine — no API keys, no accounts, no external calls.

## What it is

Runs as a local MCP server over stdio. It exposes two tools to your AI:

- **`web_search`** — Sends your query to a local SearXNG instance and returns a list of results (title, link, snippet).
- **`fetch_url`** — Fetches a webpage, strips it down to clean markdown, and returns the content.

The SearXNG backend runs in Docker by default, but you can point it at any existing SearXNG instance via the `SEARXNG_URL` env var. The fetch tool has SSRF protection — it validates domains, resolves IPs, and blocks any request to private or reserved ranges.

## Setup

Replace `$PROJECT_DIR` with the absolute path to this repo (e.g., `/home/user/repos/web-basics-mcp`).

1. Install dependencies:
   ```bash
   cd $PROJECT_DIR && bun install
   ```

2. Start the search backend (optional):
   ```bash
   docker compose up -d
   ```
   Starts a local SearXNG instance at `127.0.0.1:8088`. If you already have a SearXNG server, set the `SEARXNG_URL` env var instead.

3. Add to your MCP client config:

<details>
<summary><strong>Claude Desktop</strong></summary>

`~/.claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "web-basics": {
      "command": "bun",
      "args": ["$PROJECT_DIR/src/index.ts"]
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor</strong></summary>

`Cursor Settings > General > MCP > Add new MCP Server`:
```json
{
  "command": "bun",
  "args": ["$PROJECT_DIR/src/index.ts"]
}
```
</details>

<details>
<summary><strong>VS Code Copilot</strong></summary>

`.vscode/mcp.json`:
```json
{
  "mcpServers": {
    "web-basics": {
      "command": "bun",
      "args": ["$PROJECT_DIR/src/index.ts"]
    }
  }
}
```
</details>

<details>
<summary><strong>Claude Code</strong></summary>

`~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "web-basics": {
      "command": "bun",
      "args": ["$PROJECT_DIR/src/index.ts"]
    }
  }
}
```
</details>

<details>
<summary><strong>Other clients</strong></summary>

```json
{
  "command": "bun",
  "args": ["$PROJECT_DIR/src/index.ts"]
}
```
</details>


