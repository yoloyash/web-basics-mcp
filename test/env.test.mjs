import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadEnv } from "../build/lib/env.js";

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
