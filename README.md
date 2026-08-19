# web-basics

A local MCP server for web search and safe URL fetching. It runs over stdio, needs no third-party API key, and leaves answer synthesis to the client.

## Requirements

- Node.js 20.18.1 or newer
- A SearXNG instance with JSON responses enabled for `web_search`

`fetch_url` works without SearXNG.

## Add To Codex

```bash
codex mcp add web-basics \
  --env SEARXNG_URL=http://127.0.0.1:8088 \
  -- npx -y @yoloyash/web-basics
```

For another stdio MCP client:

```json
{
  "command": "npx",
  "args": ["-y", "@yoloyash/web-basics"],
  "env": {
    "SEARXNG_URL": "http://127.0.0.1:8088"
  }
}
```

`SEARXNG_URL` defaults to `http://127.0.0.1:8088`.

## Tools

### `web_search`

Searches the configured SearXNG instance.

- `query`: search query
- `limit`: optional result count from 1 to 10; defaults to 5

Returns results with `link`, `title`, and `snippet`.

### `fetch_url`

Fetches one public HTTP(S) URL.

- `url`: URL to fetch
- `start_index`: optional character offset; defaults to 0
- `max_length`: optional character limit from 1 to 20,000; defaults to 8,000

Supports readable web pages, PDFs, direct text formats, Reddit posts, and PNG, JPEG, WebP, or GIF images. When text is truncated, call the tool again with `next_start_index`.

Reddit posts use public old Reddit HTML for the rendered post and comments, with RSS as a fallback. Successful responses are cached by post ID for up to one hour while respecting stricter upstream cache directives.

Both tools expose MCP output schemas and return structured content alongside text content.

## Safety And Scope

Requests are limited to public HTTP(S) destinations. The server rejects credentials, private hosts, unsafe DNS results, unsafe redirects, unsupported content types, and oversized responses.

This package does not provide JavaScript rendering, browser automation, crawling, authentication, proxy routing, bundled search infrastructure, or answer synthesis.

## Development

```bash
npm ci
npm test
npm pack --dry-run
```

Normal tests do not access the public internet. Set `SEARXNG_URL` explicitly for a live search smoke test.
