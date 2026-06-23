import assert from "node:assert/strict";
import { test } from "node:test";
import { extractReadableMarkdown } from "../build/tools/extract-readable.js";

const readableText = [
  "This article explains how a small local web tool extracts the important text from a document.",
  "It keeps the paragraphs, links, images, and code examples that help a reader understand the page.",
  "It drops surrounding page furniture so the markdown result is compact enough for an agent response.",
].join(" ");

function articleHtml(body, title = "Readable Page") {
  return `<!doctype html>
    <html>
      <head><title>${title}</title></head>
      <body>
        <article>
          <h1>${title}</h1>
          <p>${readableText}</p>
          <p>${readableText}</p>
          ${body}
        </article>
      </body>
    </html>`;
}

test("extracts readable markdown with title, word count, and extractor", () => {
  const result = extractReadableMarkdown(
    articleHtml("<p>The final paragraph has the answer.</p>"),
    "https://example.com/post",
  );

  assert.equal(result.title, "Readable Page");
  assert.equal(result.extractor, "readability");
  assert.match(result.content, /final paragraph has the answer/);
  assert.ok(result.wordCount > 80);
});

test("absolutizes relative links and images before markdown conversion", () => {
  const result = extractReadableMarkdown(
    articleHtml('<p><a href="/guide">Guide</a><img src="./asset.png" alt="Diagram"></p>', "Docs Page"),
    "https://example.com/docs/page",
  );

  assert.match(result.content, /\[Guide\]\(https:\/\/example\.com\/guide\)/);
  assert.match(result.content, /!\[Diagram\]\(https:\/\/example\.com\/docs\/asset\.png\)/);
});

test("drops script, style, and navigation noise", () => {
  const result = extractReadableMarkdown(
    `<!doctype html>
      <html>
        <head><title>Noise Page</title><style>.secret { color: red; }</style></head>
        <body>
          <nav>Skip to pricing and account links</nav>
          <article>
            <h1>Noise Page</h1>
            <p>${readableText}</p>
            <p>${readableText}</p>
            <script>alert("tracking")</script>
          </article>
        </body>
      </html>`,
    "https://example.com/noise",
  );

  assert.doesNotMatch(result.content, /tracking|secret|Skip to pricing/);
  assert.equal(result.title, "Noise Page");
});

test("uses fenced code blocks", () => {
  const result = extractReadableMarkdown(
    articleHtml("<pre><code>const value = 1;\nconsole.log(value);</code></pre>", "Code Page"),
    "https://example.com/code",
  );

  assert.match(result.content, /```/);
  assert.match(result.content, /const value = 1;/);
});

test("throws a parse-shaped error when no readable content is found", () => {
  assert.throws(
    () =>
      extractReadableMarkdown(
        "<!doctype html><html><head><title>Empty</title></head><body></body></html>",
        "https://example.com/empty",
      ),
    /no readable content found/,
  );
});
