import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyError } from "../build/lib/errors.js";
import {
  DEFAULT_USER_AGENT,
  fetchPublicHttpUrl,
  readBytesCapped,
} from "../build/lib/http.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const noWait = async () => {};

test("sends the default user agent", async () => {
  let seenUserAgent;
  await fetchPublicHttpUrl("https://example.com/page", {
    fetchImpl: async (_url, init) => {
      seenUserAgent = init.headers["User-Agent"];
      return new Response("ok");
    },
    lookupHost: publicLookup,
    wait: noWait,
  });

  assert.equal(seenUserAgent, DEFAULT_USER_AGENT);
});

test("sends additional configured headers", async () => {
  let seenHeaders;
  await fetchPublicHttpUrl("https://example.com/feed", {
    fetchImpl: async (_url, init) => {
      seenHeaders = init.headers;
      return new Response("ok");
    },
    headers: { Accept: "application/atom+xml" },
    lookupHost: publicLookup,
    userAgent: "web-basics-test/1.0",
    wait: noWait,
  });

  assert.equal(seenHeaders.Accept, "application/atom+xml");
  assert.equal(seenHeaders["User-Agent"], "web-basics-test/1.0");
  assert.deepEqual(Object.keys(seenHeaders), ["User-Agent", "Accept"]);
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

test("can disable transient HTTP status retries", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchPublicHttpUrl("https://example.com/page", {
        fetchImpl: async () => {
          calls += 1;
          return new Response("busy", { status: 429 });
        },
        lookupHost: publicLookup,
        maxTransientRetries: 0,
        retryDelayMs: 0,
        wait: noWait,
      }),
    /HTTP status 429/,
  );

  assert.equal(calls, 1);
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

test("forwards caller cancellation to the active request", async () => {
  const controller = new AbortController();
  let seenSignal;
  let markRequestStarted;
  const requestStarted = new Promise((resolve) => {
    markRequestStarted = resolve;
  });
  const pending = fetchPublicHttpUrl("https://example.com/page", {
    fetchImpl: async (_url, init) => {
      seenSignal = init.signal;
      markRequestStarted();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      });
    },
    lookupHost: publicLookup,
    signal: controller.signal,
    wait: noWait,
  });

  await requestStarted;
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(seenSignal.aborted, true);
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

test("classifies unsupported binary content as a terminal validation error", () => {
  const error = classifyError(new Error("Unsupported content-type: application/zip"));
  assert.equal(error.category, "validation");
  assert.equal(error.retryable, false);
});
