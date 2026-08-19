# web-basics

Small web search and URL fetching primitives for agents. Use them as a Node.js API or run them as a local MCP server.

## Tools

- `web_search` searches one query through an existing SearXNG instance and returns `{link, title, snippet}` results.
- `fetch_url` fetches one public URL and returns readable Markdown, PDF text, direct text data, or a supported image.

Long text is returned in bounded chunks. Continue reading by calling `fetch_url` again with the returned `next_start_index`.

## Run with MCP

Requires Node.js 20.18.1 or newer and an existing SearXNG instance with JSON responses enabled.

For Codex:

```bash
codex mcp add web-basics \
  --env SEARXNG_URL=http://127.0.0.1:8088 \
  -- npx -y @yoloyash/web-basics
```

For another stdio-compatible MCP client:

```json
{
  "command": "npx",
  "args": ["-y", "@yoloyash/web-basics"],
  "env": {
    "SEARXNG_URL": "http://127.0.0.1:8088"
  }
}
```

`fetch_url` works without SearXNG. If `SEARXNG_URL` is omitted, `web_search` uses `http://127.0.0.1:8088`.

## Use as a library

```bash
npm install @yoloyash/web-basics
```

```ts
import { createWebBasics } from "@yoloyash/web-basics";

const web = createWebBasics({
  searxngUrl: "http://127.0.0.1:8088",
});

const results = await web.webSearch({ query: "Model Context Protocol" });
const page = await web.fetchUrl({ url: "https://modelcontextprotocol.io" });
```

Both methods accept an optional `AbortSignal`. The API also accepts a custom `SearchProvider`, so another search backend can be added without changing callers or the MCP tools.

## Behavior

- `web_search` accepts `query` and an optional `limit` from 1 to 10.
- `fetch_url` accepts `url`, `start_index`, and `max_length`; text responses include continuation metadata.
- Both MCP tools declare an `outputSchema` and return `structuredContent` alongside compatible text content.
- HTML extraction uses Defuddle first with a gated Mozilla Readability fallback.
- PDFs, direct text formats, PNG/JPEG/WebP/GIF images, and Reddit post URLs are supported.
- Successful fetches and searches use bounded, disposable in-memory caches.
- URLs are restricted to public HTTP(S) destinations. Credentials, private hosts, unsafe DNS results, and unsafe redirects are rejected.

This package intentionally does not provide browser automation, JavaScript rendering, crawling, authentication, proxy routing, bundled search infrastructure, or answer synthesis.

## Development

```bash
npm install
npm test
npm pack --dry-run
```

Normal tests are offline. For a live search smoke test, set `SEARXNG_URL` to an existing SearXNG deployment.
