import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadEnv, parseBooleanEnv } from "../build/lib/env.js";

test("loads package env independent of process cwd", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "web-basics-env-package-"));
  const otherCwd = await mkdtemp(join(tmpdir(), "web-basics-env-cwd-"));
  await writeFile(join(packageRoot, ".env"), "SEARXNG_URL=http://from-package.example\n");

  const previousCwd = process.cwd();
  try {
    process.chdir(otherCwd);
    const env = {};
    loadEnv({ packageRoot, env });
    assert.equal(env.SEARXNG_URL, "http://from-package.example");
  } finally {
    process.chdir(previousCwd);
  }
});

test("does not override an existing SearXNG URL", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "web-basics-env-package-"));
  await writeFile(join(packageRoot, ".env"), "SEARXNG_URL=http://from-file.example\n");
  const env = { SEARXNG_URL: "http://from-process.example" };

  loadEnv({ packageRoot, env });
  assert.equal(env.SEARXNG_URL, "http://from-process.example");
});

test("parses strict boolean environment flags", () => {
  assert.equal(parseBooleanEnv("SEARCH_FLAG", undefined), false);
  assert.equal(parseBooleanEnv("SEARCH_FLAG", " TRUE "), true);
  assert.equal(parseBooleanEnv("SEARCH_FLAG", "false", true), false);
  assert.equal(parseBooleanEnv("SEARCH_FLAG", undefined, true), true);
  assert.throws(
    () => parseBooleanEnv("SEARCH_FLAG", "yes"),
    /SEARCH_FLAG must be true or false/,
  );
});
