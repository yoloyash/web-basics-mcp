import assert from "node:assert/strict";
import { test } from "node:test";
import { ContentStore } from "../build/lib/content-store.js";
import { formatFetchedContent, formatFetchedPayload } from "../build/tools/fetch-url.js";

test("formats image fetch results as metadata and MCP image content", () => {
  const store = new ContentStore({ createId: () => "unused" });
  const imageBytes = Uint8Array.from([1, 2, 3, 4]);
  const result = formatFetchedContent(
    "https://example.com/image.png",
    {
      data: imageBytes,
      byteLength: imageBytes.byteLength,
      contentType: "image/png",
      extractor: "image",
    },
    store,
  );

  assert.equal(result.content.length, 2);
  assert.equal(result.content[0].type, "text");
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
  assert.equal(store.size, 0);
});

test("adds stored content metadata for truncated readable results", () => {
  const store = new ContentStore({ createId: () => "content-1" });
  const content = "a".repeat(9000);
  const result = formatFetchedContent(
    "https://example.com/long",
    {
      title: "Long Page",
      content,
      wordCount: 1,
      contentType: "text/html",
      extractor: "readability",
    },
    store,
  );

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.content_id, "content-1");
  assert.equal(payload.content.length, 8000);
  assert.equal(payload.total_chars, 9000);
  assert.equal(payload.returned_chars, 8000);
  assert.equal(payload.next_offset, 8000);
  assert.equal(payload.truncated, true);

  const slice = store.slice("content-1", 8000, 1000);
  assert.equal(slice.content, "a".repeat(1000));
  assert.equal(slice.totalChars, 9000);
  assert.equal(slice.truncated, false);
});

test("does not store short readable results", () => {
  const store = new ContentStore({ createId: () => "unused" });
  const result = formatFetchedContent(
    "https://example.com/short",
    {
      title: "Short Page",
      content: "short content",
      wordCount: 2,
      contentType: "text/html",
      extractor: "readability",
    },
    store,
  );

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.content_id, undefined);
  assert.equal(payload.total_chars, undefined);
  assert.equal(payload.truncated, false);
  assert.equal(store.size, 0);
});

test("adds stored content metadata to batch fetch payloads", () => {
  const store = new ContentStore({ createId: () => "content-1" });
  const payload = formatFetchedPayload(
    "https://example.com/batch-long",
    {
      title: "Batch Long Page",
      content: "b".repeat(9000),
      wordCount: 1,
      contentType: "text/html",
      extractor: "readability",
    },
    store,
  );

  assert.equal(payload.content_id, "content-1");
  assert.equal(payload.content.length, 8000);
  assert.equal(payload.total_chars, 9000);
  assert.equal(payload.returned_chars, 8000);
  assert.equal(payload.next_offset, 8000);
  assert.equal(store.slice("content-1", 8000, 1000).content, "b".repeat(1000));
});
