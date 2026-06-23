# web-basics-mcp

A self-hosted MCP server for web search and fetching. Runs entirely on your machine — no API keys, no accounts, no external calls.

## What it is

Runs as a local MCP server over stdio. It exposes two tools to your AI:

- **`web_search`** — Sends your query to a local SearXNG instance and returns a list of results (title, link, snippet).
- **`fetch_url`** — Fetches a webpage, strips it down to clean markdown, and returns the content.

The SearXNG backend runs in Docker by default, but you can point it at any existing SearXNG instance via the `SEARXNG_URL` env var. The fetch tool has SSRF protection — it validates domains, resolves IPs, and blocks any request to private or reserved ranges.

## Setup

```bash
git clone https://github.com/yourusername/web-basics-mcp.git
cd web-basics-mcp
npm install && npm run build
```

Optional — start the search backend:

```bash
docker compose up -d
```

Starts a local SearXNG instance at `127.0.0.1:8088`. If you already have one, set the `SEARXNG_URL` env var instead.

## Install

Replace `~/web-basics-mcp` with wherever you cloned the repo.

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add web-basics -- node ~/web-basics-mcp/build/index.js
```
</details>

<details>
<summary><strong>Codex</strong></summary>

```bash
codex mcp add web-basics -- node ~/web-basics-mcp/build/index.js
```
</details>

<details>
<summary><strong>OpenCode</strong></summary>

Add to your `opencode.json` (usually `~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "web-basics": {
      "type": "local",
      "command": ["node", "~/web-basics-mcp/build/index.js"],
      "enabled": true
    }
  }
}
```
</details>
