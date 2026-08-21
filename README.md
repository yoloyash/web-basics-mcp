# web-basics

A local MCP server for web search and safe URL fetching. It runs over stdio, supports SearXNG or the official Brave Search API, and leaves answer synthesis to the client.

## Requirements

- Node.js 20.18.1 or newer
- A SearXNG instance with JSON responses enabled, or a Brave Search API key, for `web_search`

`fetch_url` works without a configured search provider.

## Add To Codex

```bash
codex mcp add web-basics \
  --env SEARCH_PROVIDER=searxng \
  --env SEARXNG_URL=http://127.0.0.1:8088 \
  -- npx -y @yoloyash/web-basics
```

For another stdio MCP client:

```json
{
  "command": "npx",
  "args": ["-y", "@yoloyash/web-basics"],
  "env": {
    "SEARCH_PROVIDER": "searxng",
    "SEARXNG_URL": "http://127.0.0.1:8088"
  }
}
```

`SEARCH_PROVIDER` defaults to `searxng`, and `SEARXNG_URL` defaults to `http://127.0.0.1:8088`.

To use Brave Search instead:

```bash
codex mcp add web-basics \
  --env SEARCH_PROVIDER=brave \
  --env BRAVE_SEARCH_API_KEY=your-subscription-token \
  -- npx -y @yoloyash/web-basics
```

Brave uses its official Web Search API. Completed Brave responses are not cached; concurrent identical requests are coalesced. SearXNG searches retain the existing bounded two-minute cache.

## Tools

### `web_search`

Searches the configured SearXNG or Brave Search provider.

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

This package does not provide JavaScript rendering, browser automation, crawling, authenticated page fetching, proxy routing, bundled search infrastructure, or answer synthesis.

## Development

```bash
npm ci
npm test
npm pack --dry-run
```

Normal tests do not access the public internet. Live search smoke tests require an explicitly configured SearXNG URL or Brave Search API key.
