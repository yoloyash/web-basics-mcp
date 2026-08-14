import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractHtmlMarkdown,
  extractReadabilityMarkdown,
} from "../build/content/html.js";

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

test("uses Defuddle as the primary HTML-to-Markdown extractor", async () => {
  const result = await extractHtmlMarkdown(
    articleHtml("<p>The final paragraph has the answer.</p>"),
    "https://example.com/post",
  );

  assert.equal(result.title, "Readable Page");
  assert.equal(result.extractor, "defuddle");
  assert.match(result.content, /final paragraph has the answer/);
  assert.ok(result.wordCount > 80);
});

test("Defuddle absolutizes relative links and images", async () => {
  const result = await extractHtmlMarkdown(
    articleHtml('<p><a href="/guide">Guide</a><img src="./asset.png" alt="Diagram"></p>', "Docs Page"),
    "https://example.com/docs/page",
  );

  assert.match(result.content, /\[Guide\]\(https:\/\/example\.com\/guide\)/);
  assert.match(result.content, /!\[Diagram\]\(https:\/\/example\.com\/docs\/asset\.png\)/);
});

test("drops script, style, and navigation noise", async () => {
  const result = await extractHtmlMarkdown(
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

test("uses fenced code blocks", async () => {
  const result = await extractHtmlMarkdown(
    articleHtml("<pre><code>const value = 1;\nconsole.log(value);</code></pre>", "Code Page"),
    "https://example.com/code",
  );

  assert.match(result.content, /```/);
  assert.match(result.content, /const value = 1;/);
});

test("keeps Mozilla Readability as an independent fallback extractor", () => {
  const result = extractReadabilityMarkdown(
    articleHtml("<p>Fallback content remains readable.</p>", "Fallback Page"),
    "https://example.com/fallback",
  );

  assert.equal(result.title, "Fallback Page");
  assert.match(result.content, /Fallback content remains readable/);
});

test("selects Readability when Defuddle under-delivers", async () => {
  const result = await extractHtmlMarkdown(
    "<html><body><main>Representative page text</main></body></html>",
    "https://example.com/fallback",
    {
      extractPrimary: async () => ({
        title: "Primary",
        content: "too short",
        wordCount: 2,
      }),
      extractFallback: () => ({
        title: "Fallback",
        content: "A complete fallback extraction with the important page content preserved.".repeat(8),
        wordCount: 72,
      }),
      measurePageText: () => 2000,
    },
  );

  assert.equal(result.extractor, "readability");
  assert.equal(result.title, "Fallback");
  assert.match(result.fallbackReason, /too little content/);
});

test("throws a parse-shaped error when neither extractor finds content", async () => {
  await assert.rejects(
    () =>
      extractHtmlMarkdown(
        "<!doctype html><html><head><title>Empty</title></head><body></body></html>",
        "https://example.com/empty",
      ),
    /Failed to parse HTML content/,
  );
});
