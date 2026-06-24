import { extractPdfMarkdown, type PdfMarkdown } from "./pdf.js";
import { extractReadableMarkdown, type ReadableMarkdown } from "./html.js";

export type ExtractedContent = (ReadableMarkdown | PdfMarkdown) & {
  contentType: string;
};

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

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

  if (!isReadableContentType(contentType)) {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }

  return {
    ...extractReadableMarkdown(new TextDecoder("utf-8", { fatal: false }).decode(data), finalUrl),
    contentType: contentType || "text/html",
  };
}

export function fetchByteLimitForContentType(
  contentTypeHeader: string | null | undefined,
  readableByteLimit: number,
  pdfByteLimit: number,
): number {
  const contentType = normalizeContentType(contentTypeHeader);
  return contentType && isReadableContentType(contentType) && !isPdfContentType(contentType)
    ? readableByteLimit
    : pdfByteLimit;
}

function normalizeContentType(contentTypeHeader?: string | null): string {
  return contentTypeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isPdfContentType(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.endsWith("+pdf");
}

function isReadableContentType(contentType: string): boolean {
  return (
    !contentType ||
    contentType.startsWith("text/") ||
    contentType.includes("html") ||
    contentType.includes("xml")
  );
}

function hasPdfMagic(data: Uint8Array): boolean {
  const searchLimit = Math.min(data.length - PDF_MAGIC.length, 1024);
  for (let index = 0; index <= searchLimit; index += 1) {
    if (PDF_MAGIC.every((byte, offset) => data[index + offset] === byte)) return true;
  }
  return false;
}
