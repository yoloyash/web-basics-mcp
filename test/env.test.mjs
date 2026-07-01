import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadEnv } from "../build/lib/env.js";

test("loads package env independent of process cwd", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "web-basics-env-package-"));
  const otherCwd = await mkdtemp(join(tmpdir(), "web-basics-env-cwd-"));
  await writeFile(join(packageRoot, ".env"), "SEARXNG_URL=http://from-package.example\nHTTP_PROXY=http://proxy.example\n");

  const previousCwd = process.cwd();
  try {
    process.chdir(otherCwd);
    const env = {};

    loadEnv({ packageRoot, env });

    assert.equal(env.SEARXNG_URL, "http://from-package.example");
    assert.equal(env.HTTP_PROXY, "http://proxy.example");
  } finally {
    process.chdir(previousCwd);
  }
});

test("does not override environment values that were already set", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "web-basics-env-package-"));
  await writeFile(join(packageRoot, ".env"), "HTTP_PROXY=http://from-file.example\nHTTPS_PROXY=http://secure.example\n");

  const env = { HTTP_PROXY: "http://from-process.example" };

  loadEnv({ packageRoot, env });

  assert.equal(env.HTTP_PROXY, "http://from-process.example");
  assert.equal(env.HTTPS_PROXY, "http://secure.example");
});

test("loads WEB_BASICS_ENV_FILE before package env", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "web-basics-env-package-"));
  const configDir = await mkdtemp(join(tmpdir(), "web-basics-env-config-"));
  const customEnvPath = join(configDir, "custom.env");

  await writeFile(join(packageRoot, ".env"), "HTTP_PROXY=http://from-package.example\nNO_PROXY=localhost\n");
  await writeFile(customEnvPath, "HTTP_PROXY=http://from-custom.example\nHTTPS_PROXY=http://secure-custom.example\n");

  const env = { WEB_BASICS_ENV_FILE: customEnvPath };

  loadEnv({ packageRoot, env });

  assert.equal(env.HTTP_PROXY, "http://from-custom.example");
  assert.equal(env.HTTPS_PROXY, "http://secure-custom.example");
  assert.equal(env.NO_PROXY, "localhost");
});
