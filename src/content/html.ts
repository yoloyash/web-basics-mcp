import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export interface ReadableMarkdown {
  title: string;
  content: string;
  wordCount: number;
  extractor: "readability";
}

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

export function extractReadableMarkdown(html: string, finalUrl: string): ReadableMarkdown {
  const { document } = parseHTML(html);
  ensureBaseUrl(document, finalUrl);

  const article = new Readability<string>(document.cloneNode(true) as Document, {
    serializer: (node) => (node as HTMLElement).innerHTML,
  }).parse();

  if (!article?.content?.trim()) {
    throw new Error("Failed to parse readable content: no readable content found");
  }

  const content = normalizeMarkdown(turndown.turndown(article.content));
  if (!content) {
    throw new Error("Failed to parse readable content: no readable content found");
  }

  return {
    title: article.title?.trim() || finalUrl,
    content,
    wordCount: countWords(article.textContent ?? content),
    extractor: "readability",
  };
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

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}
