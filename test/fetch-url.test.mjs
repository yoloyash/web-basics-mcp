import assert from "node:assert/strict";
import { test } from "node:test";
import { createFetchUrlResult } from "../build/api.js";
import { fetchUrlContent, responseAllowsCaching } from "../build/content/fetch.js";
import { formatFetchedContent, formatFetchedPayload } from "../build/tools/fetch-url.js";

test("caches fetched content under the requested and final URLs", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return {
      finalUrl: "https://example.com/cache-final",
      result: {
        title: "Cached",
        content: "stable content",
        wordCount: 2,
        contentType: "text/plain",
        extractor: "text",
      },
    };
  };

  const first = await fetchUrlContent("https://example.com/cache-start#first", load);
  const second = await fetchUrlContent("https://example.com/cache-start#second", load);
  const redirected = await fetchUrlContent("https://example.com/cache-final", load);

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(first, redirected);
});

test("caches Reddit URL variants under their canonical post ID", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return {
      cacheTtlMs: 60 * 60_000,
      finalUrl: "https://www.reddit.com/r/example/comments/cache123/canonical-title/",
      result: {
        title: "Cached Reddit post",
        content: "stable Reddit content",
        wordCount: 3,
        contentType: "text/html",
        extractor: "reddit",
      },
    };
  };

  const first = await fetchUrlContent(
    "https://old.reddit.com/r/example/comments/CACHE123/old-title/?utm_source=test#comments",
    load,
  );
  const second = await fetchUrlContent(
    "https://www.reddit.com/r/example/comments/cache123/different-title/",
    load,
  );

  assert.equal(calls, 1);
  assert.equal(first, second);
});

test("honors response cache-control directives", () => {
  assert.equal(responseAllowsCaching(new Response("content")), true);
  assert.equal(responseAllowsCaching(responseWithCacheControl("public, max-age=60")), true);
  assert.equal(responseAllowsCaching(responseWithCacheControl("no-store")), false);
  assert.equal(responseAllowsCaching(responseWithCacheControl("public, no-cache")), false);
  assert.equal(responseAllowsCaching(responseWithCacheControl("max-age = 0")), false);
});

test("does not retain fetch results marked uncacheable", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return {
      cacheable: false,
      finalUrl: "https://example.com/no-store",
      result: {
        title: "Uncacheable",
        content: `request ${calls}`,
        wordCount: 2,
        contentType: "text/plain",
        extractor: "text",
      },
    };
  };

  const first = await fetchUrlContent("https://example.com/no-store", load);
  const second = await fetchUrlContent("https://example.com/no-store", load);

  assert.equal(calls, 2);
  assert.notEqual(first.result.content, second.result.content);
});

function responseWithCacheControl(cacheControl) {
  return new Response("content", { headers: { "cache-control": cacheControl } });
}

test("formats image fetch results as metadata and MCP image content", () => {
  const imageBytes = Uint8Array.from([1, 2, 3, 4]);
  const result = formatFetchedContent(
    createFetchUrlResult("https://example.com/image.png", {
      data: imageBytes,
      byteLength: imageBytes.byteLength,
      contentType: "image/png",
      extractor: "image",
    }),
  );

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
  assert.deepEqual(result.structuredContent, JSON.parse(result.content[0].text));
});

test("slices text content directly with start_index and max_length", () => {
  const source = {
    title: "Long Page",
    content: "abcdefghij",
    wordCount: 1,
    contentType: "text/html",
    extractor: "defuddle",
  };

  const first = formatFetchedPayload(
    createFetchUrlResult("https://example.com/long", source, 0, 4),
  );
  assert.equal(first.content, "abcd");
  assert.equal(first.start_index, 0);
  assert.equal(first.returned_chars, 4);
  assert.equal(first.total_chars, 10);
  assert.equal(first.next_start_index, 4);
  assert.equal(first.truncated, true);

  const second = formatFetchedPayload(
    createFetchUrlResult("https://example.com/long", source, 4, 20),
  );
  assert.equal(second.content, "efghij");
  assert.equal(second.start_index, 4);
  assert.equal(second.returned_chars, 6);
  assert.equal(second.next_start_index, undefined);
  assert.equal(second.truncated, false);
});

test("allows reading exactly at the end of text content", () => {
  const payload = formatFetchedPayload(
    createFetchUrlResult("https://example.com/short", {
      title: "Short Page",
      content: "short",
      wordCount: 1,
      contentType: "text/plain",
      extractor: "text",
    }, 5, 10),
  );

  assert.equal(payload.content, "");
  assert.equal(payload.returned_chars, 0);
  assert.equal(payload.truncated, false);
});

test("rejects text offsets beyond the extracted content", () => {
  assert.throws(
    () =>
      createFetchUrlResult(
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
    /startIndex cannot exceed content length/,
  );
});

test("includes extractor fallback and PDF metadata", () => {
  const fallback = formatFetchedPayload(
    createFetchUrlResult("https://example.com/page", {
      title: "Page",
      content: "fallback content",
      wordCount: 2,
      contentType: "text/html",
      extractor: "readability",
      fallbackReason: "Defuddle failed: no content found",
    }),
  );
  assert.equal(fallback.fallback_reason, "Defuddle failed: no content found");

  const pdf = formatFetchedPayload(
    createFetchUrlResult("https://example.com/file.pdf", {
      title: "PDF",
      content: "pdf content",
      wordCount: 2,
      contentType: "application/pdf",
      extractor: "unpdf",
      pageCount: 2,
      metadata: { Author: "Example" },
      links: ["https://example.com"],
    }),
  );
  assert.equal(pdf.pageCount, 2);
  assert.deepEqual(pdf.metadata, { Author: "Example" });
  assert.deepEqual(pdf.links, ["https://example.com"]);
});
