import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractPdfMarkdown } from "../build/content/pdf.js";

const readablePdf = new Uint8Array(await readFile(new URL("./fixtures/readable.pdf", import.meta.url)));
const blankPdf = new Uint8Array(await readFile(new URL("./fixtures/blank.pdf", import.meta.url)));

test("extracts selectable PDF text, metadata, links, and page count", async () => {
  const result = await extractPdfMarkdown(readablePdf, "https://example.com/readable.pdf");

  assert.equal(result.extractor, "unpdf");
  assert.equal(result.title, "Readable PDF Fixture");
  assert.equal(result.pageCount, 1);
  assert.match(result.content, /^## Page 1/);
  assert.match(result.content, /Selectable PDF fixture text/);
  assert.match(result.content, /Visit Example Link/);
  assert.equal(result.metadata.Author, "web-basics-mcp tests");
  assert.deepEqual(result.links, ["https://example.com/pdf-link"]);
  assert.ok(result.wordCount > 8);
});

test("throws a parse-shaped error when no selectable PDF text is found", async () => {
  await assert.rejects(
    () => extractPdfMarkdown(blankPdf, "https://example.com/blank.pdf"),
    /no extractable PDF text found/,
  );
});
