import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  SearchChainError,
  type SearchResponse,
  type WebBasics,
} from "../api.js";
import { classifyError } from "../lib/errors.js";

const searchSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
  publishedDate: z.string().optional(),
  ageSeconds: z.number().optional(),
  author: z.string().optional(),
});

const searchCitationSchema = z.object({
  url: z.string(),
  title: z.string(),
  citedText: z.string().optional(),
});

const searchUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  searchRequests: z.number().optional(),
  totalTokens: z.number().optional(),
});

const searchResponseSchema = z.object({
  provider: z.enum([
    "brave",
    "duckduckgo",
    "exa",
    "firecrawl",
    "none",
    "searxng",
  ]),
  answer: z.string().optional(),
  sources: z.array(searchSourceSchema),
  citations: z.array(searchCitationSchema).optional(),
  searchQueries: z.array(z.string()).optional(),
  relatedQuestions: z.array(z.string()).optional(),
  usage: searchUsageSchema.optional(),
  model: z.string().optional(),
  requestId: z.string().optional(),
  authMode: z.string().optional(),
});

export default function registerWebSearch(server: McpServer, webBasics: WebBasics) {
  server.registerTool(
    "web_search",
    {
      description: "Run one web query through the first available search provider and return formatted source URLs plus the provider response.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_LIMIT).describe("Result limit"),
        recency: z.enum(["day", "week", "month", "year"]).optional().describe("Relative time filter"),
        max_tokens: z.number().int().positive().optional().describe("Provider answer token cap when supported"),
        temperature: z.number().optional().describe("Provider sampling temperature when supported"),
        num_search_results: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional().describe("Requested search breadth or local result cap"),
      },
      outputSchema: {
        response: searchResponseSchema,
        error: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit, recency, max_tokens, temperature, num_search_results }, { signal }) => {
      try {
        const response = await webBasics.webSearch({
          query,
          limit,
          recency,
          maxTokens: max_tokens,
          numSearchResults: num_search_results,
          temperature,
          signal,
        });
        return {
          content: [{ type: "text", text: formatForLlm(response) }],
          structuredContent: { response },
        };
      } catch (err) {
        if (signal.aborted) throw err;
        if (err instanceof SearchChainError) {
          const error = err.message;
          return {
            content: [{ type: "text", text: `Error: ${error}` }],
            structuredContent: {
              response: { provider: err.provider, sources: [] },
              error,
            },
          };
        }
        const { category, message, retryable } = classifyError(err);
        const retryHint = typeof retryable === "boolean" ? ` (retryable: ${retryable})` : "";
        return { content: [{ type: "text", text: `${category}: ${message}${retryHint}` }], isError: true };
      }
    },
  );
}

function formatForLlm(response: SearchResponse): string {
  const parts: string[] = [];
  if (response.answer) {
    parts.push(response.answer);
    if (response.sources.length > 0) {
      parts.push("\n## Sources");
      parts.push(formatCount("source", response.sources.length));
    }
  }
  for (const [index, source] of response.sources.entries()) {
    const age = formatAge(source.ageSeconds) || source.publishedDate;
    const agePart = age ? ` (${age})` : "";
    parts.push(`[${index + 1}] ${source.title}${agePart}\n    ${source.url}`);
    if (source.snippet) parts.push(`    ${truncateText(source.snippet, 240)}`);
  }
  if (response.citations?.length) {
    parts.push("\n## Citations");
    parts.push(formatCount("citation", response.citations.length));
    for (const [index, citation] of response.citations.entries()) {
      parts.push(`[${index + 1}] ${citation.title || citation.url}\n    ${citation.url}`);
      if (citation.citedText) {
        parts.push(`    ${truncateText(citation.citedText, 240)}`);
      }
    }
  }
  if (response.relatedQuestions?.length) {
    parts.push("\n## Related");
    parts.push(formatCount("question", response.relatedQuestions.length));
    for (const question of response.relatedQuestions) parts.push(`- ${question}`);
  }
  if (response.searchQueries?.length) {
    parts.push(`Search queries: ${response.searchQueries.length}`);
    for (const query of response.searchQueries.slice(0, 3)) {
      parts.push(`- ${truncateText(query, 120)}`);
    }
  }
  return parts.join("\n");
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatCount(label: string, count: number): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function formatAge(ageSeconds: number | undefined): string | undefined {
  if (ageSeconds === undefined || !Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return undefined;
  }
  if (ageSeconds < 60) return `${Math.floor(ageSeconds)}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}
