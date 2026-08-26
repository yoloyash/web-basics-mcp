import {
  fetchPublicHttpUrl,
  readBytesCapped,
  type FetchPublicHttpOptions,
} from "./http.js";
import {
  coalesceSearchProvider,
  createSearchProvider,
  normalizeSearchProviderLimit,
  normalizeSearchSources,
  type SearchProvider,
  type SearchSourceCandidate,
} from "./search-provider.js";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 10_000;

type ExaDependencies = Pick<
  FetchPublicHttpOptions,
  "fetchImpl" | "lookupHost" | "wait"
>;

export function createExaSearchProvider(
  dependencies: ExaDependencies = {},
): SearchProvider {
  return coalesceSearchProvider(createSearchProvider({
    id: "exa",
    label: "Exa",
    async search(params) {
      const limit = normalizeSearchProviderLimit(
        params.numSearchResults ?? params.limit,
      );
      const { res } = await fetchPublicHttpUrl(EXA_MCP_URL, {
        ...dependencies,
        body: JSON.stringify({
          id: "web-basics-search",
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: { numResults: limit, query: params.query },
            name: "web_search_exa",
          },
        }),
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "x-exa-source": "web-basics",
        },
        maxRedirects: 0,
        maxTransientRetries: 0,
        method: "POST",
        signal: params.signal,
        timeoutMs: SEARCH_TIMEOUT_MS,
      });

      const contentType = res.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (
        contentType !== "application/json" &&
        contentType !== "text/event-stream" &&
        !contentType?.endsWith("+json")
      ) {
        throw new Error(`Unsupported content-type from Exa: ${contentType ?? "unknown"}`);
      }
      const text = new TextDecoder().decode(
        await readBytesCapped(res, MAX_RESPONSE_BYTES, params.signal),
      );
      const response = parseMcpResponse(text);
      if (!isRecord(response)) throw new Error("Failed to parse Exa MCP response");
      if (isRecord(response.error)) {
        throw new Error(
          typeof response.error.message === "string"
            ? `Exa MCP error: ${response.error.message}`
            : "Exa MCP returned an error",
        );
      }
      if (!isRecord(response.result)) {
        throw new Error("Exa MCP response did not include a result");
      }
      if (response.result.isError === true) {
        throw new Error(extractErrorText(response.result) ?? "Exa MCP search failed");
      }

      return {
        sources: normalizeSearchSources(extractExaCandidates(response.result), limit),
      };
    },
  }));
}

function parseMcpResponse(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return parseJson(trimmed);

  let parsed: unknown;
  for (const block of trimmed.split(/\r?\n\r?\n/u)) {
    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    const value = parseJson(data);
    if (value !== undefined) parsed = value;
  }
  return parsed;
}

function extractExaCandidates(result: Record<string, unknown>): SearchSourceCandidate[] {
  const structured = result.structuredContent;
  const structuredCandidates = candidatesFromPayload(structured);
  if (structuredCandidates.length > 0) return structuredCandidates;

  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") continue;
    const jsonPayload = parseJson(item.text);
    const jsonCandidates = candidatesFromPayload(jsonPayload);
    if (jsonCandidates.length > 0) return jsonCandidates;
    const textCandidates = candidatesFromText(item.text);
    if (textCandidates.length > 0) return textCandidates;
  }
  return [];
}

function candidatesFromPayload(payload: unknown): SearchSourceCandidate[] {
  if (!isRecord(payload)) return [];
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results.flatMap((result) => {
    if (!isRecord(result) || typeof result.url !== "string") return [];
    return [{
      url: result.url,
      title: typeof result.title === "string" ? result.title : undefined,
      snippet: firstString(
        result.summary,
        result.text,
        Array.isArray(result.highlights)
          ? result.highlights.filter((value): value is string => typeof value === "string").join(" ")
          : undefined,
      ),
    }];
  });
}

function candidatesFromText(text: string): SearchSourceCandidate[] {
  return text.split(/\n\s*---\s*\n/gu).flatMap((section) => {
    const title = /^Title:\s*(.+)$/mu.exec(section)?.[1]?.trim();
    const url = /^URL:\s*(\S+)$/mu.exec(section)?.[1]?.trim();
    if (!url) return [];
    const highlights = /(?:^|\n)Highlights:\s*\n([\s\S]*)$/mu.exec(section)?.[1]?.trim();
    return [{ url, title, snippet: highlights }];
  });
}

function extractErrorText(result: Record<string, unknown>): string | undefined {
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      const text = item.text.trim();
      if (text) return text;
    }
  }
  return undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && !!value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
