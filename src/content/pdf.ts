import { extractLinks, extractText, getDocumentProxy, getMeta } from "unpdf";

export interface PdfMarkdown {
  title: string;
  content: string;
  wordCount: number;
  extractor: "unpdf";
  pageCount: number;
  metadata: Record<string, string | number | boolean | null>;
  links: string[];
}

export async function extractPdfMarkdown(data: Uint8Array, finalUrl: string): Promise<PdfMarkdown> {
  const pdf = await getDocumentProxy(data);

  try {
    const textResult = await extractText(pdf, { mergePages: false });
    const metaResult = await getMeta(pdf).catch(() => undefined);
    const linkResult = await extractLinks(pdf).catch(() => ({ links: [] }));

    const pages = textResult.text.map(normalizePdfText);
    const content = pages
      .map((page, index) => (page ? `## Page ${index + 1}\n\n${page}` : ""))
      .filter(Boolean)
      .join("\n\n");

    if (!content) {
      throw new Error("Failed to parse PDF content: no extractable PDF text found");
    }

    const metadata = normalizeMetadata(metaResult);

    return {
      title: getMetadataTitle(metadata) ?? finalUrl,
      content,
      wordCount: countWords(pages.join("\n\n")),
      extractor: "unpdf",
      pageCount: textResult.totalPages,
      metadata,
      links: [...new Set(linkResult.links)],
    };
  } finally {
    await pdf.destroy();
  }
}

function normalizePdfText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeMetadata(
  metaResult?: { info?: Record<string, unknown>; metadata?: unknown },
): Record<string, string | number | boolean | null> {
  return {
    ...toSerializableRecord(getEmbeddedMetadata(metaResult?.metadata)),
    ...toSerializableRecord(metaResult?.info),
  };
}

function getEmbeddedMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object" || !("getAll" in metadata)) return undefined;

  const getAll = (metadata as { getAll?: unknown }).getAll;
  if (typeof getAll !== "function") return undefined;

  return getAll.call(metadata) as Record<string, unknown>;
}

function toSerializableRecord(input?: Record<string, unknown>): Record<string, string | number | boolean | null> {
  if (!input) return {};

  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      const serialized = serializeMetadataValue(value);
      return serialized === undefined ? [] : [[key, serialized]];
    }),
  );
}

function serializeMetadataValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function getMetadataTitle(metadata: Record<string, string | number | boolean | null>): string | undefined {
  const title = metadata.Title ?? metadata.title;
  return typeof title === "string" && title.trim() ? title.trim() : undefined;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}
