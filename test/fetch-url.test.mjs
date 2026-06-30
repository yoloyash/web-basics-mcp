import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFetchedContent } from "../build/tools/fetch-url.js";

test("formats image fetch results as metadata and MCP image content", () => {
  const imageBytes = Uint8Array.from([1, 2, 3, 4]);
  const result = formatFetchedContent("https://example.com/image.png", {
    data: imageBytes,
    byteLength: imageBytes.byteLength,
    contentType: "image/png",
    extractor: "image",
  });

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
});
