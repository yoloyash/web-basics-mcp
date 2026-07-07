import assert from "node:assert/strict";
import { test } from "node:test";
import { ContentStore } from "../build/lib/content-store.js";

const storedContent = {
  url: "https://example.com/long",
  title: "Long Page",
  content: "abcdef",
  contentType: "text/html",
  extractor: "readability",
};

test("slices stored content by offset and limit", () => {
  const store = new ContentStore({ createId: () => "content-1" });
  const contentId = store.put(storedContent);
  const slice = store.slice(contentId, 2, 3);

  assert.equal(slice.contentId, "content-1");
  assert.equal(slice.content, "cde");
  assert.equal(slice.offset, 2);
  assert.equal(slice.returnedChars, 3);
  assert.equal(slice.totalChars, 6);
  assert.equal(slice.nextOffset, 5);
  assert.equal(slice.truncated, true);
});

test("rejects unknown or expired content ids", () => {
  let now = 0;
  const store = new ContentStore({
    createId: () => "content-1",
    now: () => now,
    ttlMs: 10,
  });

  store.put(storedContent);
  now = 11;

  assert.throws(() => store.slice("content-1", 0, 1), /Unknown or expired content_id/);
  assert.throws(() => store.slice("missing", 0, 1), /Unknown or expired content_id/);
});

test("rejects offsets beyond the stored content length", () => {
  const store = new ContentStore({ createId: () => "content-1" });
  store.put(storedContent);

  assert.throws(() => store.slice("content-1", 7, 1), /offset cannot exceed stored content length/);
});

test("evicts oldest content when the store is full", () => {
  let id = 0;
  const store = new ContentStore({
    createId: () => `content-${++id}`,
    maxEntries: 1,
  });

  store.put(storedContent);
  store.put({ ...storedContent, content: "newer" });

  assert.equal(store.size, 1);
  assert.throws(() => store.slice("content-1", 0, 1), /Unknown or expired content_id/);
  assert.equal(store.slice("content-2", 0, 5).content, "newer");
});
