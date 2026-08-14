# web-basics-mcp

Small, dependable web tools for agents. No API keys and no bundled infrastructure.

## Tools

| Tool | What it does |
| --- | --- |
| `web_search` | Searches one query through an existing SearXNG instance |
| `fetch_url` | Fetches one page, text document, PDF, image, or Reddit post |

`fetch_url` returns clean Markdown for HTML pages and Reddit posts, selectable text for PDFs, direct content for text/Markdown/JSON/XML responses, and native MCP image content for PNG, JPEG, WebP, and GIF images.

Long text is read in bounded chunks. Call the same URL again with the returned `next_start_index`:

```json
{
  "url": "https://example.com/long-page",
  "start_index": 8000,
  "max_length": 8000
}
```

## Requirements

- Node.js 20.18.1 or newer
- An existing SearXNG instance with JSON responses enabled

Set its base URL in the environment or in this package's `.env` file:

```env
SEARXNG_URL=http://127.0.0.1:8088
```

The server starts even when SearXNG is unavailable so `fetch_url` remains usable. Calls to `web_search` return a clear connection error until SearXNG is reachable.

## Install

```bash
git clone https://github.com/yoloyash/web-basics-mcp.git
cd web-basics-mcp
npm install
npm run build
```

Configure an MCP client to run `build/index.js` over stdio. For example:

```bash
codex mcp add web-basics -- node /absolute/path/to/web-basics-mcp/build/index.js
```

## Tool Inputs

### `web_search`

```json
{
  "query": "Model Context Protocol",
  "limit": 5
}
```

`limit` defaults to 5 and accepts values from 1 through 10. Results use the stable shape `{link, title, snippet}`.

### `fetch_url`

```json
{
  "url": "https://example.com",
  "start_index": 0,
  "max_length": 8000
}
```

- `start_index` defaults to 0.
- `max_length` defaults to 8000 and is capped at 20000.
- Text responses report `total_chars`, `returned_chars`, `truncated`, and, when more content remains, `next_start_index`.
- HTML uses Defuddle first and Mozilla Readability as a gated fallback. The response reports the selected `extractor` and the fallback reason when applicable.
- Defuddle's optional network-backed extractors are disabled. Every remote request stays in this server's validated HTTP path.
- Reddit post URLs are fetched through Reddit's RSS feed and include the post plus comments available in that feed. RSS may contain fewer comments than the website.

## Safety And Limits

- Only public HTTP(S) URLs are accepted.
- URL credentials, private hostnames, private DNS results, and unsafe redirects are rejected.
- Each redirect is validated independently.
- Requests use timeouts, bounded retries, response-size limits, and a stable user agent.
- Standard responses and images are capped at 5 MiB; PDFs are capped at 15 MiB.

This server intentionally does not provide browser automation, JavaScript rendering, crawling, authentication, cookies, proxy/VPN routing, or answer synthesis.

## Development

```bash
npm test
npm pack --dry-run
```

Tests use saved fixtures and local stubs rather than repeatedly querying public services.
