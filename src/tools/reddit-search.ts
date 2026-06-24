import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError, validationError } from "./errors.js";

const FETCH_TIMEOUT_MS = 10000;
const MAX_QUERY_LENGTH = 500;
const REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com"]);

interface SearxResult {
  url: string;
  title?: string;
  content?: string;
  score?: number;
  engines?: string[];
}

interface RedditPostUrl {
  canonicalUrl: string;
  subreddit: string;
  postId: string;
  slug: string;
}

export default function registerRedditSearch(server: McpServer) {
  server.registerTool(
    "reddit_search",
    {
      description: "Search Reddit for posts. Returns post links and discovery metadata. Use reddit_fetch to fetch comments.",
      inputSchema: {
        query: z.string().describe("Search query"),
        subreddit: z.string().optional().describe("Optional subreddit to restrict search to (e.g., programming, AskReddit)"),
        limit: z.number().int().min(1).max(25).default(10).describe("Result limit (max 25)"),
      },
    },
    async ({ query, subreddit, limit }) => {
      try {
        const normalizedQuery = normalizeQuery(query);
        const normalizedSubreddit = normalizeSubreddit(subreddit);
        const u = createSearchUrl();

        const siteQuery = normalizedSubreddit
          ? `site:reddit.com/r/${normalizedSubreddit}/comments ${normalizedQuery}`
          : `site:reddit.com/r/ ${normalizedQuery}`;
        u.searchParams.set("q", siteQuery);
        u.searchParams.set("format", "json");
        u.searchParams.set("safesearch", "1");
        u.searchParams.set("language", "all");

        const res = await fetch(u.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP status ${res.status} from SearXNG`);

        const json = (await res.json()) as {
          results?: SearxResult[];
        };

        const seen = new Set<string>();
        const results = (json.results ?? [])
          .flatMap((result) => {
            const postUrl = parseRedditPostUrl(result.url);
            if (!postUrl) return [];
            if (normalizedSubreddit && postUrl.subreddit.toLowerCase() !== normalizedSubreddit.toLowerCase()) return [];
            if (seen.has(postUrl.postId)) return [];
            seen.add(postUrl.postId);

            return [
              {
                title: cleanTitle(result.title) || postUrl.slug.replaceAll("_", " "),
                link: postUrl.canonicalUrl,
                subreddit: `r/${postUrl.subreddit}`,
                post_id: postUrl.postId,
                slug: postUrl.slug,
                search_score: result.score ?? null,
                source_engines: result.engines ?? [],
                snippet: result.content ?? "",
              },
            ];
          })
          .slice(0, limit);

        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      } catch (err) {
        const { category, message } = classifyError(err);
        return { content: [{ type: "text", text: `${category}: ${message}` }], isError: true };
      }
    },
  );
}

function normalizeSubreddit(input?: string): string | undefined {
  if (!input) return undefined;

  const name = input.trim().replace(/^\/?r\//i, "");
  if (!name) return undefined;
  if (!/^[a-zA-Z0-9_]{2,21}$/.test(name)) {
    throw validationError("Invalid subreddit. Use a subreddit name like typescript or r/typescript.");
  }

  return name;
}

function normalizeQuery(input: string): string {
  const query = input.trim();
  if (!query) throw validationError("Query cannot be empty");
  if (query.length > MAX_QUERY_LENGTH) throw validationError(`Query cannot exceed ${MAX_QUERY_LENGTH} characters`);
  return query;
}

function createSearchUrl(): URL {
  try {
    return new URL("/search", process.env.SEARXNG_URL ?? "http://127.0.0.1:8088");
  } catch {
    throw validationError("SEARXNG_URL must be a valid URL");
  }
}

function parseRedditPostUrl(rawUrl: string): RedditPostUrl | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }

  if (!REDDIT_HOSTS.has(url.hostname.toLowerCase())) return undefined;

  const parts = url.pathname.split("/").filter(Boolean);
  const rIndex = parts.findIndex((part) => part.toLowerCase() === "r");
  if (rIndex === -1) return undefined;

  const subreddit = parts[rIndex + 1];
  const commentsSegment = parts[rIndex + 2];
  const postId = parts[rIndex + 3];
  const slug = parts[rIndex + 4] ?? "";
  if (!subreddit || commentsSegment?.toLowerCase() !== "comments" || !postId) return undefined;

  return {
    canonicalUrl: `https://www.reddit.com/r/${subreddit}/comments/${postId}/${slug ? `${slug}/` : ""}`,
    subreddit,
    postId,
    slug,
  };
}

function cleanTitle(title?: string): string {
  return (title ?? "").replace(/\s+-\s+Reddit$/i, "").trim();
}
