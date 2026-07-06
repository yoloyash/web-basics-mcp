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

const rscText = [
  "This RSC-only fixture has enough useful text to prove that the content router can recover text from Next.js flight data.",
  "The visible HTML body does not contain a readable article, so Readability should fail before the RSC fallback succeeds.",
  "That keeps the fallback narrow while still helping modern documentation pages.",
].join(" ");

const rscHtml = encoder.encode(rscPage([
  [
    "23",
    element("main", [
      element("h1", "RSC Routed Fixture"),
      element("p", rscText),
    ]),
  ],
]));

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

test("routes HTML content to the readability extractor", async () => {
  const result = await extractFetchedContent(
    readableHtml,
    "https://example.com/readable.html",
    "text/html; charset=utf-8",
  );

  assert.equal(result.extractor, "readability");
  assert.equal(result.contentType, "text/html");
  assert.match(result.content, /ordinary web pages still use the HTML path/);
});

test("routes RSC-only HTML content to the RSC extractor", async () => {
  const result = await extractFetchedContent(
    rscHtml,
    "https://example.com/rsc",
    "text/html; charset=utf-8",
  );

  assert.equal(result.extractor, "rsc");
  assert.equal(result.contentType, "text/html");
  assert.match(result.content, /# RSC Routed Fixture/);
  assert.match(result.content, /Next\.js flight data/);
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

test("uses larger fetch byte limit for PDFs, unknown content types, and unsupported images", () => {
  assert.equal(fetchByteLimitForContentType("application/pdf", 5, 15), 15);
  assert.equal(fetchByteLimitForContentType("application/octet-stream", 5, 15), 15);
  assert.equal(fetchByteLimitForContentType("image/bmp", 5, 15), 15);
  assert.equal(fetchByteLimitForContentType(undefined, 5, 15), 15);
});

function rscPage(chunks) {
  const payload = chunks.map(([id, node]) => `${id}:${JSON.stringify(node)}`).join("\n");
  return `<!doctype html>
    <html>
      <head><title>RSC Routed Fixture</title></head>
      <body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body>
    </html>`;
}

function element(tag, children, props = {}) {
  return ["$", tag, null, { ...props, children }];
}
