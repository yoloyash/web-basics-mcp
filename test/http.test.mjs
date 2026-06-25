import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyError } from "../build/lib/errors.js";
import {
  DEFAULT_USER_AGENT,
  fetchPublicHttpUrl,
  readBytesCapped,
  resolveUserAgent,
} from "../build/lib/http.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const noWait = async () => {};

test("resolves default and custom fetch user agents", () => {
  assert.equal(resolveUserAgent({}), DEFAULT_USER_AGENT);
  assert.equal(resolveUserAgent({ WEB_BASICS_USER_AGENT: "  custom-agent/1.0  " }), "custom-agent/1.0");
  assert.equal(resolveUserAgent({ WEB_BASICS_USER_AGENT: "   " }), DEFAULT_USER_AGENT);
});

test("sends the configured user agent", async () => {
  let seenUserAgent;
  await fetchPublicHttpUrl("https://example.com/page", {
    fetchImpl: async (_url, init) => {
      seenUserAgent = init.headers["User-Agent"];
      return new Response("ok");
    },
    lookupHost: publicLookup,
    userAgent: "web-basics-test/1.0",
    wait: noWait,
  });

  assert.equal(seenUserAgent, "web-basics-test/1.0");
});

test("retries one transient HTTP status before succeeding", async () => {
  const statuses = [503, 200];
  let calls = 0;

  const result = await fetchPublicHttpUrl("https://example.com/page", {
    fetchImpl: async () => new Response("ok", { status: statuses[calls++] }),
    lookupHost: publicLookup,
    retryDelayMs: 0,
    wait: noWait,
  });

  assert.equal(calls, 2);
  assert.equal(result.res.status, 200);
});

test("marks exhausted transient HTTP status as retryable", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchPublicHttpUrl("https://example.com/page", {
        fetchImpl: async () => {
          calls += 1;
          return new Response("busy", { status: 503 });
        },
        lookupHost: publicLookup,
        retryDelayMs: 0,
        wait: noWait,
      }),
    (err) => {
      assert.equal(calls, 2);
      assert.equal(classifyError(err).category, "http");
      assert.equal(classifyError(err).retryable, true);
      return true;
    },
  );
});

test("does not retry terminal HTTP status", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchPublicHttpUrl("https://example.com/missing", {
        fetchImpl: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
        lookupHost: publicLookup,
        wait: noWait,
      }),
    (err) => {
      assert.equal(classifyError(err).category, "http");
      assert.equal(classifyError(err).retryable, false);
      return true;
    },
  );

  assert.equal(calls, 1);
});

test("retries one transient network error before succeeding", async () => {
  let calls = 0;

  const result = await fetchPublicHttpUrl("https://example.com/page", {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("socket hang up");
        err.code = "ECONNRESET";
        throw err;
      }
      return new Response("ok");
    },
    lookupHost: publicLookup,
    retryDelayMs: 0,
    wait: noWait,
  });

  assert.equal(calls, 2);
  assert.equal(result.res.status, 200);
});

test("does not fetch private hostnames", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchPublicHttpUrl("http://localhost:8080", {
        fetchImpl: async () => {
          calls += 1;
          return new Response("ok");
        },
        lookupHost: publicLookup,
        wait: noWait,
      }),
    /Private hostnames not allowed/,
  );

  assert.equal(calls, 0);
});

test("marks oversized bodies as non-retryable", async () => {
  await assert.rejects(
    () => readBytesCapped(new Response("too large", { headers: { "content-length": "9" } }), 5),
    (err) => {
      assert.equal(classifyError(err).category, "validation");
      assert.equal(classifyError(err).retryable, false);
      return true;
    },
  );
});
