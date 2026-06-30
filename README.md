# web-basics-mcp

A tiny MCP server that gives agents basic web tools without API keys.

It can search the web through SearXNG, fetch readable page content, and pull Reddit threads from RSS.

## Tools

- **`web_search`** - Search the web with SearXNG.
- **`fetch_url`** - Fetch a page or PDF and turn it into readable markdown.
- **`reddit_search`** - Find Reddit posts.
- **`reddit_fetch`** - Fetch a Reddit post and its comments.

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

By default, the server uses `http://127.0.0.1:8088` for SearXNG. You can set `SEARXNG_URL` in your shell, your MCP client config, or a local `.env` file.

## Search Backend

To start the bundled local SearXNG service:

```bash
docker compose up -d
```

That exposes SearXNG at `http://127.0.0.1:8088`. Stop it with:

```bash
docker compose down
```

You can also point `SEARXNG_URL` at any existing SearXNG instance that has JSON output enabled.

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
      "enabled": true
    }
  }
}
```
</details>

## Development

```bash
npm run build
npm test
```

## Behavior

- The server runs as a local MCP server over stdio.
- Search uses the SearXNG instance configured by `SEARXNG_URL`.
- If `HTTP_PROXY` or `HTTPS_PROXY` is set, outbound requests use that proxy.
- `fetch_url` only supports public HTTP(S) pages and blocks private/local addresses.
- Reddit support uses Reddit's RSS feed, so it may return fewer comments than the full website.
- Returned content is capped to keep MCP responses manageable.
- Search quality depends on the engines enabled in your SearXNG configuration.
