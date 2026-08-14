# Repository Guidelines

`web-basics-mcp` is a simple MCP server that gives agents basic web tools without API keys. Keep it easy to run, easy to inspect, and boring in the best Node/npm sense.

## Project Layout

```text
.
|-- src/
|   |-- index.ts      # stdio entrypoint
|   |-- server.ts     # MCP server factory
|   |-- tools/        # thin register* tool adapters
|   |   |-- index.ts
|   |   |-- fetch-url.ts
|   |   `-- web-search.ts
|   |-- lib/          # shared HTTP, search, Reddit, env, and error helpers
|   `-- content/      # HTML, PDF, image, Reddit, and fetch routing
|-- test/             # Node test runner tests and fixtures
`-- build/            # compiled output
```

Keep this structure shallow. Tool files should register MCP tools and delegate real behavior to `src/lib/` or `src/content/`.

## Commands

- `npm install`: install dependencies.
- `npm run build`: compile TypeScript to `build/`.
- `npm run start`: run the compiled MCP server.
- `npm run dev`: watch TypeScript during development.
- `npm test`: build and run the test suite.
- `npm pack --dry-run`: check package contents and runtime build output.
- `SEARXNG_URL=http://... node ...`: point an explicit live smoke test at an existing SearXNG instance. Keep normal tests offline.

Run `npm test` before handing off code changes. Use `npm pack --dry-run` for package or publish-facing changes.

## Coding Style

Use strict TypeScript and ES modules. Local imports need explicit `.js` extensions because the project uses Node16 module resolution. Follow the existing style: two-space indentation, double quotes, and semicolons.

Keep file names kebab-case. MCP tool names are snake_case, such as `fetch_url`. Keep adapters small and default-exported as `register*` functions.

Do not choose the "easy" hacky fix just because it is fast. Prefer standard, conventional TypeScript and Node practices, even for small changes.

## Tests

Tests use Node's built-in test runner and live in `test/`. Prefer focused behavior tests for validation, network safety, response shape, extraction, and error paths. Avoid public-internet tests unless they are clearly marked as integration tests.

## Security And Behavior

- Preserve `fetch_url` protections for pages, PDFs, images, and Reddit: protocols, credentials, private hostnames, DNS results, redirects, content types, and response size. Reddit post URLs also use the public-address DNS check.

- HTML extraction is Defuddle-first with `useAsync: false`, followed by a gated Mozilla Readability fallback. Do not allow extractors to make network requests outside `src/lib/http.ts`.

- Preserve the intentionally small single-input contracts: `web_search` accepts one `query`; `fetch_url` accepts one `url` plus `start_index` and `max_length`.

- Keep returned content bounded. Long `fetch_url` results are continued by calling the same URL with the returned `next_start_index`.

- Runtime configuration loads from the package-root `.env` file. Do not make config depend on the MCP client's working directory.

- Do not add proxy/VPN routing. The only service configuration is `SEARXNG_URL`, which points at an existing SearXNG deployment.

- Use `SEARXNG_URL` for search backend configuration. Keep returned content bounded and leave answer synthesis to the client/model rather than hiding it inside the server.

## Branches, Commits And PRs

- Keep changes easy to review and easy to promote back to `main` when they are stable.
- For parallel feature work, branch from `dev` so PRs stay independent.
- Use conventional commit messages. Keep commits focused and describe the user-visible change. PRs should include a concise summary, verification steps, and any configuration changes.
