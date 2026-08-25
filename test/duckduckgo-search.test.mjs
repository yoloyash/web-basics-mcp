import assert from "node:assert/strict";
import { test } from "node:test";
import { createDuckDuckGoSearchProvider } from "@yoloyash/web-basics";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("parses DuckDuckGo no-JavaScript HTML results", async () => {
  let request;
  const provider = createDuckDuckGoSearchProvider({
    fetchImpl: async (url, init) => {
      request = { url: new URL(url), init };
      return htmlResponse(`
        <html><body>
          <div class="result">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fresult%23fragment">
              Example <b>result</b>
            </a>
            <a class="result__snippet">A useful <b>snippet</b>.</a>
          </div>
          <div class="result">
            <a class="result__a" href="https://example.com/second">Second result</a>
            <a class="result__snippet">Second snippet.</a>
          </div>
        </body></html>
      `);
    },
    lookupHost: publicLookup,
  });

  assert.deepEqual(await provider("duckduckgo query", undefined, 1), [{
    link: "https://example.com/result",
    title: "Example result",
    snippet: "A useful snippet.",
  }]);
  assert.equal(request.url.toString(), "https://html.duckduckgo.com/html/");
  assert.equal(request.init.method, "POST");
  const form = new URLSearchParams(request.init.body);
  assert.equal(form.get("q"), "duckduckgo query");
  assert.equal(form.get("kl"), "us-en");
});

test("detects DuckDuckGo bot challenges", async () => {
  const provider = createDuckDuckGoSearchProvider({
    fetchImpl: async () => htmlResponse("<html><div class=\"anomaly-modal\"></div></html>"),
    lookupHost: publicLookup,
  });

  await assert.rejects(
    () => provider("challenged query"),
    /bot-detection challenge/,
  );
});

function htmlResponse(value) {
  return new Response(value, { headers: { "content-type": "text/html; charset=utf-8" } });
}
