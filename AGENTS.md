# Repository Instructions

`web-basics` is a small Node.js package and stdio MCP server. Its public surface is intentionally limited to web search and safe URL fetching.

## Architecture

```text
src/
|-- index.ts       # public package exports
|-- api.ts         # core API and types
|-- stdio.ts       # executable entrypoint
|-- server.ts      # MCP server factory
|-- tools/         # MCP adapters
|-- lib/           # HTTP, search, cache, env, and error helpers
`-- content/       # HTML, PDF, image, Reddit, and text extraction

test/               # Node test runner tests and fixtures
docs/               # maintainer runbooks
build/              # generated package output
```

Keep MCP adapters thin. Shared behavior belongs in `src/api.ts`, `src/lib/`, or `src/content/`.

## Contracts And Boundaries

- Preserve the `web_search` and `fetch_url` tool names and result shapes unless a contract change is intentional.
- `web_search` accepts `query` and `limit`. `fetch_url` accepts `url`, `start_index`, and `max_length`.
- Keep results bounded. Continue long text with `next_start_index`.
- Route all outbound fetches through `src/lib/http.ts`. Preserve checks for protocols, credentials, private hosts, DNS results, redirects, content types, and response sizes.
- Keep HTML extraction offline after fetch: Defuddle first, then the gated Readability fallback.
- Keep caches optional and disposable. Never cache failures or make correctness depend on a cache hit.
- Keep the completed-result search cache limited to SearXNG. For Brave Search, coalesce only concurrent identical requests and do not retain completed API responses.
- For Reddit post URLs, fetch public old Reddit HTML first and use RSS only as a fallback. Cache successful results by canonical post ID for at most one hour, honor stricter upstream cache directives, and do not require credentials.
- Load runtime configuration from the package-root `.env`, not the MCP client's working directory.
- `SEARCH_PROVIDER` selects `searxng` or `brave`; SearXNG remains the default. `SEARXNG_URL` points to user-managed infrastructure, while Brave uses its fixed official endpoint and `BRAVE_SEARCH_API_KEY`. Do not add bundled search, proxy/VPN routing, browser automation, or answer synthesis.

## Code Style

- Use strict TypeScript and ES modules with explicit `.js` extensions for local imports.
- Use two-space indentation, double quotes, semicolons, and kebab-case file names.
- Keep MCP tool names snake_case and tool registration functions as default-exported `register*` functions.

## Verification

- Run `npm test` for code changes.
- Run `npm pack --dry-run` for package, export, executable, or publishing changes.
- Keep normal tests offline. Live search checks must use an explicitly supplied `SEARXNG_URL` or `BRAVE_SEARCH_API_KEY` for the selected provider.
- Add focused tests for validation, network safety, response shapes, extraction, and error paths.

## Changes And Releases

Use conventional commits and focused PRs. Include the behavior changed, verification performed, and any configuration impact in the PR description.

For publishing, follow [`docs/releases.md`](docs/releases.md).
