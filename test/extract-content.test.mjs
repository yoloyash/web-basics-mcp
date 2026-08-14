import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  extractFetchedContent,
  fetchByteLimitForContentType,
} from "../build/content/index.js";

const readablePdfBytes = await readFile(new URL("./fixtures/readable.pdf", import.meta.url));
const encoder = new TextEncoder();
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const readableHtml = encoder.encode(`<!doctype html>
  <html>
    <head><title>Readable HTML Fixture</title></head>
    <body>
      <article>
        <h1>Readable HTML Fixture</h1>
        <p>This HTML fixture has enough readable text for the readability extractor to keep it.</p>
        <p>It lets the content router prove that ordinary web pages still use the HTML path.</p>
        <p>That keeps PDF support from changing the behavior of normal page fetching.</p>
      </article>
    </body>
  </html>`);

test("routes application/pdf content to the PDF extractor", async () => {
  const result = await extractFetchedContent(
    readablePdf(),
    "https://example.com/readable.pdf",
    "application/pdf",
  );

  assert.equal(result.extractor, "unpdf");
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.pageCount, 1);
});

test("routes PDF magic bytes to the PDF extractor when content type is generic", async () => {
  const result = await extractFetchedContent(
    readablePdf(),
    "https://example.com/readable.pdf",
    "application/octet-stream",
  );

  assert.equal(result.extractor, "unpdf");
  assert.match(result.content, /Selectable PDF fixture text/);
});

function readablePdf() {
  return Uint8Array.from(readablePdfBytes);
}

test("routes HTML content through the HTML extraction pipeline", async () => {
  const result = await extractFetchedContent(
    readableHtml,
    "https://example.com/readable.html",
    "text/html; charset=utf-8",
  );

  assert.ok(["defuddle", "readability"].includes(result.extractor));
  assert.equal(result.contentType, "text/html");
  assert.match(result.content, /ordinary web pages still use the HTML path/);
});

test("returns plain text, Markdown, and JSON directly", async () => {
  for (const [contentType, content] of [
    ["text/plain", "plain text response"],
    ["text/markdown", "# Markdown response"],
    ["application/json", '{"ok":true}'],
  ]) {
    const result = await extractFetchedContent(
      encoder.encode(content),
      "https://example.com/data",
      contentType,
    );
    assert.equal(result.extractor, "text");
    assert.equal(result.contentType, contentType);
    assert.equal(result.content, content);
  }
});

test("sniffs HTML when the response has no content type", async () => {
  const result = await extractFetchedContent(readableHtml, "https://example.com/readable.html");
  assert.ok(["defuddle", "readability"].includes(result.extractor));
  assert.equal(result.contentType, "text/html");
});

test("routes supported raster image content to the image extractor", async () => {
  const result = await extractFetchedContent(
    pngBytes,
    "https://example.com/image.png",
    "image/png; charset=binary",
  );

  assert.equal(result.extractor, "image");
  assert.equal(result.contentType, "image/png");
  assert.equal(result.byteLength, pngBytes.byteLength);
  assert.deepEqual([...result.data], [...pngBytes]);
});

test("sniffs supported raster image signatures when content type is generic", async () => {
  const result = await extractFetchedContent(
    pngBytes,
    "https://example.com/download",
    "application/octet-stream",
  );

  assert.equal(result.extractor, "image");
  assert.equal(result.contentType, "image/png");
});

test("rejects unsupported non-PDF binary content", async () => {
  await assert.rejects(
    () => extractFetchedContent(encoder.encode("not a bitmap"), "https://example.com/image.bmp", "image/bmp"),
    /Unsupported content-type: image\/bmp/,
  );
});

test("uses smaller fetch byte limit for readable content and supported images", () => {
  assert.equal(fetchByteLimitForContentType("text/html", 5, 15), 5);
  assert.equal(fetchByteLimitForContentType("image/png", 5, 15), 5);
  assert.equal(fetchByteLimitForContentType("image/gif; charset=binary", 5, 15), 5);
});

test("uses larger fetch byte limit only when content type is missing or PDF-like", () => {
  assert.equal(fetchByteLimitForContentType("application/pdf", 5, 15), 15);
  assert.equal(fetchByteLimitForContentType("application/octet-stream", 5, 15), 5);
  assert.equal(fetchByteLimitForContentType("image/bmp", 5, 15), 5);
  assert.equal(fetchByteLimitForContentType(undefined, 5, 15), 15);
});
