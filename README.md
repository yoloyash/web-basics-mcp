# web-basics-mcp

Basic web tools for agents. No API keys.

Search the web, fetch URLs, and read Reddit posts from any MCP client.

## What It Provides

| Tool | Use it for |
| --- | --- |
| `web_search` | Search the web |
| `fetch_url` | Fetch pages, PDFs, and images |
| `reddit_search` | Find Reddit posts |
| `reddit_fetch` | Read a Reddit post and its comments |

## Requirements

- Node.js 20.18.1 or newer
- npm
- Docker, only if you want to run the optional local SearXNG backend

## Setup

```bash
git clone https://github.com/yoloyash/web-basics-mcp.git
cd web-basics-mcp
npm install
npm run build
```

Optional: copy the example environment file if you want to change the search backend.

```bash
cp .env.example .env
```

## Search Backend

If you want local web search, start the bundled search backend:

```bash
docker compose up -d
```

Stop it with:

```bash
docker compose down
```

By default, the server expects search at `http://127.0.0.1:8088`. Set `SEARXNG_URL` if you use a different search backend.

## Optional Proxy/VPN Routing

If you already run a proxy behind a VPN, you can route outbound requests through it with standard proxy environment variables:

```bash
HTTPS_PROXY=http://127.0.0.1:19080
HTTP_PROXY=http://127.0.0.1:19080
NO_PROXY=127.0.0.1,localhost
```

This works with Gluetun's HTTP proxy, for example. Prefer a localhost or LAN-only proxy endpoint; do not expose it to the public internet.

## Install In MCP Clients

Replace `~/web-basics-mcp` with the path where you cloned this repo.

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

Add this to your `opencode.json`, usually at `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "web-basics": {
      "type": "local",
      "command": ["node", "~/web-basics-mcp/build/index.js"],
      "environment": {
        "SEARXNG_URL": "http://127.0.0.1:8088"
      },
      "enabled": true
    }
  }
}
```

Replace the `SEARXNG_URL` value with your own SearXNG instance if it is not on localhost:8088.
</details>

## Development

```bash
npm run build
npm test
```

## Under The Hood

- The server runs as a local MCP server over stdio.
- Search uses the SearXNG instance configured by `SEARXNG_URL`.
- If `HTTP_PROXY` or `HTTPS_PROXY` is set, outbound requests use that proxy.
- `fetch_url` only supports public HTTP(S) pages and blocks private/local addresses.
- Set `WEB_BASICS_USER_AGENT` to customize the fetch user agent.
- Reddit support uses Reddit's RSS feed, so it may return fewer comments than the full website.
- Returned content is capped to keep MCP responses manageable.
- Search quality depends on the engines enabled in your SearXNG configuration.
