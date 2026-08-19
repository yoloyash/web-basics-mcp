import assert from "node:assert/strict";
import { test } from "node:test";
import { TtlLruCache } from "../build/lib/cache.js";

test("expires entries without extending TTL on reads", () => {
  let now = 0;
  const cache = new TtlLruCache({ maxEntries: 2, now: () => now, ttlMs: 10 });

  cache.set("key", "value");
  now = 9;
  assert.equal(cache.get("key"), "value");
  now = 10;
  assert.equal(cache.get("key"), undefined);
});

test("evicts the least recently used entry", () => {
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 1000 });

  cache.set("first", 1);
  cache.set("second", 2);
  assert.equal(cache.get("first"), 1);
  cache.set("third", 3);

  assert.equal(cache.get("second"), undefined);
  assert.equal(cache.get("first"), 1);
  assert.equal(cache.get("third"), 3);
});

test("enforces the total cache weight", () => {
  const cache = new TtlLruCache({
    maxEntries: 10,
    maxWeight: 5,
    ttlMs: 1000,
    weigh: (value) => value.length,
  });

  cache.set("first", "abc");
  cache.set("second", "def");
  assert.equal(cache.get("first"), undefined);
  assert.equal(cache.get("second"), "def");

  cache.set("oversized", "abcdef");
  assert.equal(cache.get("oversized"), undefined);
});

test("coalesces concurrent loads", async () => {
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 1000 });
  let calls = 0;
  let finishLoad;
  const load = () => {
    calls += 1;
    return new Promise((resolve) => {
      finishLoad = resolve;
    });
  };

  const first = cache.getOrLoad("key", load);
  const second = cache.getOrLoad("key", load);
  assert.equal(calls, 1);
  finishLoad("value");

  assert.deepEqual(await Promise.all([first, second]), ["value", "value"]);
});

test("cancels one waiter without aborting a shared load", async () => {
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 1000 });
  const firstController = new AbortController();
  let finishLoad;
  let loadSignal;
  const load = (signal) => {
    loadSignal = signal;
    return new Promise((resolve) => {
      finishLoad = resolve;
    });
  };

  const first = cache.getOrLoad("key", load, undefined, firstController.signal);
  const second = cache.getOrLoad("key", load);
  firstController.abort();

  await assert.rejects(first, { name: "AbortError" });
  assert.equal(loadSignal.aborted, false);
  finishLoad("value");
  assert.equal(await second, "value");
});

test("aborts an in-flight load when every waiter cancels", async () => {
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 1000 });
  const controller = new AbortController();
  let loadSignal;
  const load = (signal) => {
    loadSignal = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };

  const pending = cache.getOrLoad("key", load, undefined, controller.signal);
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(loadSignal.aborted, true);
});

test("does not cache failures or values rejected by policy", async () => {
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 1000 });
  let failureCalls = 0;
  const fail = async () => {
    failureCalls += 1;
    throw new Error("failed");
  };

  await assert.rejects(() => cache.getOrLoad("failure", fail), /failed/);
  await assert.rejects(() => cache.getOrLoad("failure", fail), /failed/);
  assert.equal(failureCalls, 2);

  let skippedCalls = 0;
  const skip = async () => {
    skippedCalls += 1;
    return "uncacheable";
  };
  await cache.getOrLoad("skipped", skip, () => false);
  await cache.getOrLoad("skipped", skip, () => false);
  assert.equal(skippedCalls, 2);
});
