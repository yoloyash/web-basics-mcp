import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFetchedContent, formatFetchedPayload } from "../build/tools/fetch-url.js";

test("formats image fetch results as metadata and MCP image content", () => {
  const imageBytes = Uint8Array.from([1, 2, 3, 4]);
  const result = formatFetchedContent("https://example.com/image.png", {
    data: imageBytes,
    byteLength: imageBytes.byteLength,
    contentType: "image/png",
    extractor: "image",
  });

  assert.equal(result.content.length, 2);
  assert.deepEqual(JSON.parse(result.content[0].text), {
    url: "https://example.com/image.png",
    contentType: "image/png",
    byteLength: 4,
    extractor: "image",
  });
  assert.deepEqual(result.content[1], {
    type: "image",
    data: "AQIDBA==",
    mimeType: "image/png",
  });
});

test("slices text content directly with start_index and max_length", () => {
  const source = {
    title: "Long Page",
    content: "abcdefghij",
    wordCount: 1,
    contentType: "text/html",
    extractor: "defuddle",
  };

  const first = formatFetchedPayload("https://example.com/long", source, 0, 4);
  assert.equal(first.content, "abcd");
  assert.equal(first.start_index, 0);
  assert.equal(first.returned_chars, 4);
  assert.equal(first.total_chars, 10);
  assert.equal(first.next_start_index, 4);
  assert.equal(first.truncated, true);

  const second = formatFetchedPayload("https://example.com/long", source, 4, 20);
  assert.equal(second.content, "efghij");
  assert.equal(second.start_index, 4);
  assert.equal(second.returned_chars, 6);
  assert.equal(second.next_start_index, undefined);
  assert.equal(second.truncated, false);
});

test("allows reading exactly at the end of text content", () => {
  const payload = formatFetchedPayload(
    "https://example.com/short",
    {
      title: "Short Page",
      content: "short",
      wordCount: 1,
      contentType: "text/plain",
      extractor: "text",
    },
    5,
    10,
  );

  assert.equal(payload.content, "");
  assert.equal(payload.returned_chars, 0);
  assert.equal(payload.truncated, false);
});

test("rejects text offsets beyond the extracted content", () => {
  assert.throws(
    () =>
      formatFetchedPayload(
        "https://example.com/short",
        {
          title: "Short Page",
          content: "short",
          wordCount: 1,
          contentType: "text/plain",
          extractor: "text",
        },
        6,
        10,
      ),
    /start_index cannot exceed content length/,
  );
});

test("includes extractor fallback and PDF metadata", () => {
  const fallback = formatFetchedPayload("https://example.com/page", {
    title: "Page",
    content: "fallback content",
    wordCount: 2,
    contentType: "text/html",
    extractor: "readability",
    fallbackReason: "Defuddle failed: no content found",
  });
  assert.equal(fallback.fallback_reason, "Defuddle failed: no content found");

  const pdf = formatFetchedPayload("https://example.com/file.pdf", {
    title: "PDF",
    content: "pdf content",
    wordCount: 2,
    contentType: "application/pdf",
    extractor: "unpdf",
    pageCount: 2,
    metadata: { Author: "Example" },
    links: ["https://example.com"],
  });
  assert.equal(pdf.pageCount, 2);
  assert.deepEqual(pdf.metadata, { Author: "Example" });
  assert.deepEqual(pdf.links, ["https://example.com"]);
});
