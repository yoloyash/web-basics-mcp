import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

test("HTTP_PROXY routes configured fetch through the configured proxy", async () => {
  const requests = [];
  const proxy = createServer();
  proxy.on("connect", (req, socket) => {
    requests.push({ method: "CONNECT", url: req.url });
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", (chunk) => {
      const [requestLine] = chunk.toString("utf8").split("\r\n");
      requests.push({ method: "TUNNELED", url: requestLine });
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\nproxied");
    });
  });

  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const { port } = proxy.address();

  try {
    const env = { ...process.env };
    for (const name of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"]) {
      delete env[name];
    }
    env.HTTP_PROXY = `http://127.0.0.1:${port}`;

    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { getGlobalDispatcher } from "undici";
          import { initProxy } from "./build/lib/proxy.js";
          import { fetch } from "./build/lib/fetch.js";
          initProxy();
          const res = await fetch("http://proxy.test/example");
          console.log(await res.text());
          await getGlobalDispatcher().close();
        `,
      ],
      {
        cwd: new URL("..", import.meta.url),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const stdoutPromise = streamText(child.stdout);
    const stderrPromise = streamText(child.stderr);
    const [code] = await once(child, "exit");
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    assert.equal(code, 0, stderr);
    assert.equal(stdout.trim(), "proxied");
    assert.deepEqual(requests, [
      { method: "CONNECT", url: "proxy.test:80" },
      { method: "TUNNELED", url: "GET /example HTTP/1.1" },
    ]);
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
  }
});

async function streamText(stream) {
  let text = "";
  for await (const chunk of stream) {
    text += chunk;
  }
  return text;
}
