import { Readability } from "@mozilla/readability";
import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export interface HtmlMarkdown {
  title: string;
  content: string;
  wordCount: number;
  extractor: "defuddle" | "readability";
  fallbackReason?: string;
}

export interface HtmlCandidate {
  title: string;
  content: string;
  wordCount: number;
}

export interface HtmlExtractionDependencies {
  extractPrimary?: (html: string, finalUrl: string) => Promise<HtmlCandidate>;
  extractFallback?: (html: string, finalUrl: string) => HtmlCandidate;
  measurePageText?: (html: string) => number;
}

const MIN_PRIMARY_CONTENT_CHARS = 200;
const LARGE_PAGE_TEXT_CHARS = 5000;
const MIN_LARGE_PAGE_COVERAGE = 0.08;
const MAX_LOW_COVERAGE_CONTENT_CHARS = 1200;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});

turndown.remove((node) =>
  ["script", "style", "noscript", "template", "svg"].includes(node.nodeName.toLowerCase()),
);

export async function extractHtmlMarkdown(
  html: string,
  finalUrl: string,
  dependencies: HtmlExtractionDependencies = {},
): Promise<HtmlMarkdown> {
  const extractPrimary = dependencies.extractPrimary ?? extractDefuddleMarkdown;
  const extractFallback = dependencies.extractFallback ?? extractReadabilityMarkdown;
  const measurePageText = dependencies.measurePageText ?? pageTextLength;
  let primary: HtmlCandidate | undefined;
  let fallbackReason: string;

  try {
    primary = await extractPrimary(html, finalUrl);
    fallbackReason = primaryFallbackReason(primary.content, measurePageText(html));
    if (!fallbackReason) return { ...primary, extractor: "defuddle" };
  } catch (err) {
    fallbackReason = `Defuddle failed: ${errorMessage(err)}`;
  }

  try {
    const fallback = extractFallback(html, finalUrl);
    if (!primary || fallback.content.length >= primary.content.length * 1.5) {
      return {
        ...fallback,
        extractor: "readability",
        fallbackReason,
      };
    }
  } catch (err) {
    if (!primary) {
      throw new Error(
        `Failed to parse HTML content: ${fallbackReason}; Readability failed: ${errorMessage(err)}`,
      );
    }
  }

  return { ...primary, extractor: "defuddle" };
}

export async function extractDefuddleMarkdown(html: string, finalUrl: string): Promise<HtmlCandidate> {
  const { document } = parseHTML(html);
  const result = await Defuddle(document, finalUrl, {
    includeReplies: false,
    markdown: true,
    useAsync: false,
  });
  const content = normalizeMarkdown(result.content ?? "");
  if (!content) throw new Error("no content found");

  return {
    title: result.title?.trim() || document.title?.trim() || finalUrl,
    content,
    wordCount: result.wordCount ?? countWords(content),
  };
}

export function extractReadabilityMarkdown(html: string, finalUrl: string): HtmlCandidate {
  const { document } = parseHTML(html);
  ensureBaseUrl(document, finalUrl);

  const article = new Readability<string>(document.cloneNode(true) as Document, {
    serializer: (node) => (node as HTMLElement).innerHTML,
  }).parse();

  if (!article?.content?.trim()) throw new Error("no content found");

  const content = normalizeMarkdown(turndown.turndown(article.content));
  if (!content) throw new Error("no content found");

  return {
    title: article.title?.trim() || finalUrl,
    content,
    wordCount: countWords(article.textContent ?? content),
  };
}

function primaryFallbackReason(content: string, totalPageTextChars: number): string {
  if (content.length < MIN_PRIMARY_CONTENT_CHARS && totalPageTextChars >= MIN_PRIMARY_CONTENT_CHARS * 2) {
    return "Defuddle returned too little content for the page";
  }

  if (
    totalPageTextChars >= LARGE_PAGE_TEXT_CHARS &&
    content.length < MAX_LOW_COVERAGE_CONTENT_CHARS &&
    content.length / totalPageTextChars < MIN_LARGE_PAGE_COVERAGE
  ) {
    return "Defuddle returned low content coverage for the page";
  }

  return "";
}

function pageTextLength(html: string): number {
  const { document } = parseHTML(html);
  return normalizeWhitespace(document.body?.textContent ?? "").length;
}

function ensureBaseUrl(document: Document, finalUrl: string): void {
  if (document.querySelector("base[href]")) return;

  const base = document.createElement("base");
  base.setAttribute("href", finalUrl);

  if (document.head) {
    document.head.prepend(base);
    return;
  }

  const head = document.createElement("head");
  head.append(base);
  document.documentElement?.prepend(head);
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
