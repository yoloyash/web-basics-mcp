# web-basics

A local MCP server for resilient web search and safe URL fetching. It runs over stdio, supports configured and keyless search providers, and leaves answer synthesis to the client.

## Requirements

- Node.js 20.18.1 or newer
- A SearXNG instance or Brave Search API key is optional; keyless search is available through `SEARCH_PROVIDER=auto`

`fetch_url` works without a configured search provider.

## Add To Codex

For automatic fallback with no required credentials:

```bash
codex mcp add web-basics \
  --env SEARCH_PROVIDER=auto \
  -- npx -y @yoloyash/web-basics
```

When configured, automatic search tries Brave and SearXNG first, followed by keyless Firecrawl, anonymous Exa MCP, and DuckDuckGo HTML. Searches are sequential and stop after the first provider returns results. Keyless services are best-effort and may enforce their own rate limits or bot challenges.

To prioritize Brave and then a SearXNG instance before keyless fallback:

```bash
codex mcp add web-basics \
  --env SEARCH_PROVIDER=auto \
  --env BRAVE_SEARCH_API_KEY=your-subscription-token \
  --env SEARXNG_URL=http://127.0.0.1:8088 \
  -- npx -y @yoloyash/web-basics
```

To pin SearXNG without fallback:

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

`SEARCH_PROVIDER` accepts `auto`, `brave`, `searxng`, `firecrawl`, `exa`, or `duckduckgo`. It defaults to `searxng`, and explicitly selected SearXNG defaults to `http://127.0.0.1:8088`. In automatic mode, SearXNG is included only when `SEARXNG_URL` is set.

To use Brave Search instead:

```bash
codex mcp add web-basics \
  --env SEARCH_PROVIDER=brave \
  --env BRAVE_SEARCH_API_KEY=your-subscription-token \
  -- npx -y @yoloyash/web-basics
```

Brave uses its official Web Search API. SearXNG searches retain a bounded two-minute cache. Brave and keyless providers coalesce concurrent identical requests but do not retain completed responses.

## Tools

### `web_search`

Searches the selected provider or automatic fallback chain.

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

Public provider requests and fetched URLs are limited to safe HTTP(S) destinations. The server rejects URL credentials, unsafe DNS results and redirects, unsupported content types, and oversized responses. User-managed SearXNG endpoints may be private.

This package does not provide JavaScript rendering, browser automation, crawling, authenticated page fetching, proxy routing, bundled search infrastructure, or answer synthesis.

## Development

```bash
npm ci
npm test
npm pack --dry-run
```

Normal tests do not access the public internet. Live smoke tests should explicitly select the provider being tested; Brave and SearXNG require their corresponding configuration.
