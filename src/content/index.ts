import { extractHtmlMarkdown, type HtmlMarkdown } from "./html.js";
import { extractPdfMarkdown, type PdfMarkdown } from "./pdf.js";
import type { RedditMarkdown } from "./reddit.js";

type ExtractedReadableContent = (HtmlMarkdown | PdfMarkdown | RedditMarkdown | TextContent) & {
  contentType: string;
};

export interface TextContent {
  title: string;
  content: string;
  wordCount: number;
  extractor: "text";
}

export interface ExtractedImageContent {
  data: Uint8Array;
  byteLength: number;
  contentType: string;
  extractor: "image";
}

export type ExtractedContent = ExtractedReadableContent | ExtractedImageContent;

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const DIRECT_TEXT_CONTENT_TYPES = new Set([
  "application/atom+xml",
  "application/json",
  "application/ld+json",
  "application/rss+xml",
  "application/xml",
  "application/yaml",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/x-markdown",
  "text/xml",
  "text/yaml",
]);

export async function extractFetchedContent(
  data: Uint8Array,
  finalUrl: string,
  contentTypeHeader?: string | null,
): Promise<ExtractedContent> {
  const contentType = normalizeContentType(contentTypeHeader);

  if (isPdfContentType(contentType) || hasPdfMagic(data)) {
    return {
      ...(await extractPdfMarkdown(data, finalUrl)),
      contentType: "application/pdf",
    };
  }

  const imageContentType = isSupportedImageContentType(contentType)
    ? contentType
    : detectImageContentType(data);
  if (imageContentType) {
    return {
      data,
      byteLength: data.byteLength,
      contentType: imageContentType,
      extractor: "image",
    };
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  if (isHtmlContentType(contentType) || (!contentType && looksLikeHtml(text))) {
    return {
      ...(await extractHtmlMarkdown(text, finalUrl)),
      contentType: contentType || "text/html",
    };
  }

  if (!contentType || isDirectTextContentType(contentType)) {
    return {
      title: finalUrl,
      content: text,
      wordCount: countWords(text),
      contentType: contentType || "text/plain",
      extractor: "text",
    };
  }

  throw new Error(`Unsupported content-type: ${contentType}`);
}

export function fetchByteLimitForContentType(
  contentTypeHeader: string | null | undefined,
  standardByteLimit: number,
  pdfByteLimit: number,
): number {
  const contentType = normalizeContentType(contentTypeHeader);
  return !contentType || isPdfContentType(contentType) ? pdfByteLimit : standardByteLimit;
}

function normalizeContentType(contentTypeHeader?: string | null): string {
  return contentTypeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isPdfContentType(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.endsWith("+pdf");
}

function isSupportedImageContentType(contentType: string): boolean {
  return SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType);
}

function isHtmlContentType(contentType: string): boolean {
  return contentType === "text/html" || contentType === "application/xhtml+xml";
}

function isDirectTextContentType(contentType: string): boolean {
  return DIRECT_TEXT_CONTENT_TYPES.has(contentType) || contentType.startsWith("text/");
}

function looksLikeHtml(text: string): boolean {
  return /<!doctype\s+html|<html(?:\s|>)/iu.test(text.slice(0, 1024));
}

function detectImageContentType(data: Uint8Array): string | undefined {
  if (
    data.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => data[index] === byte,
    )
  ) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 6) {
    const signature = String.fromCharCode(...data.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function hasPdfMagic(data: Uint8Array): boolean {
  const searchLimit = Math.min(data.length - PDF_MAGIC.length, 1024);
  for (let index = 0; index <= searchLimit; index += 1) {
    if (PDF_MAGIC.every((byte, offset) => data[index + offset] === byte)) return true;
  }
  return false;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}
