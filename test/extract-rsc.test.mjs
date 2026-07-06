import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRscMarkdown } from "../build/content/rsc.js";

const longText = [
  "This React Server Components fixture contains enough real prose to count as useful extracted page content.",
  "It lets the parser prove that the payload embedded in the Next.js flight stream can become readable markdown.",
  "The fixture stays local and deterministic so the test does not depend on a public website.",
].join(" ");

test("extracts headings and paragraphs from RSC flight chunks", () => {
  const result = extractRscMarkdown(
    rscHtml([
      [
        "23",
        element("main", [
          element("h1", "RSC Fixture"),
          element("p", longText),
          element("ul", [element("li", "First useful item"), element("li", "Second useful item")]),
        ]),
      ],
    ]),
    "https://example.com/docs",
  );

  assert.ok(result);
  assert.equal(result.title, "RSC Fixture");
  assert.equal(result.extractor, "rsc");
  assert.match(result.content, /# RSC Fixture/);
  assert.match(result.content, /Next\.js flight stream/);
  assert.match(result.content, /- First useful item/);
  assert.ok(result.wordCount > 30);
});

test("resolves referenced RSC chunks", () => {
  const result = extractRscMarkdown(
    rscHtml([
      ["23", element("main", "$L1")],
      ["1", element("section", [element("h2", "Referenced Section"), element("p", longText)])],
    ]),
    "https://example.com/reference",
  );

  assert.ok(result);
  assert.match(result.content, /## Referenced Section/);
  assert.match(result.content, /payload embedded in the Next\.js flight stream/);
});

test("preserves fenced code blocks without inline backticks", () => {
  const result = extractRscMarkdown(
    rscHtml([
      [
        "23",
        element("main", [
          element("h1", "Code Fixture"),
          element("p", longText),
          element("pre", element("code", "const value = 1;\nconsole.log(value);")),
        ]),
      ],
    ]),
    "https://example.com/code",
  );

  assert.ok(result);
  assert.match(result.content, /```\nconst value = 1;\nconsole\.log\(value\);\n```/);
  assert.doesNotMatch(result.content, /`const value = 1;/);
});

test("renders simple markdown tables", () => {
  const result = extractRscMarkdown(
    rscHtml([
      [
        "23",
        element("main", [
          element("h1", "Table Fixture"),
          element("p", longText),
          element("table", [
            element("thead", element("tr", [element("th", "Tool"), element("th", "Use")])),
            element("tbody", [
              element("tr", [element("td", "fetch_url"), element("td", "Read pages")]),
              element("tr", [element("td", "web_search"), element("td", "Find sources")]),
            ]),
          ]),
        ]),
      ],
    ]),
    "https://example.com/table",
  );

  assert.ok(result);
  assert.match(result.content, /\| Tool \| Use \|/);
  assert.match(result.content, /\| --- \| --- \|/);
  assert.match(result.content, /\| fetch_url \| Read pages \|/);
});

test("returns null for ordinary HTML without RSC payloads", () => {
  assert.equal(
    extractRscMarkdown("<!doctype html><html><head><title>Plain</title></head><body>Plain page</body></html>", "https://example.com"),
    null,
  );
});

function rscHtml(chunks, title = "RSC Fixture | Example") {
  const payload = chunks.map(([id, node]) => `${id}:${JSON.stringify(node)}`).join("\n");
  return `<!doctype html>
    <html>
      <head><title>${title}</title></head>
      <body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body>
    </html>`;
}

function element(tag, children, props = {}) {
  return ["$", tag, null, { ...props, children }];
}
