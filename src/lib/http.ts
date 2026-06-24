import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { validationError } from "./errors.js";

const FETCH_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;

export async function fetchPublicHttpUrl(
  rawUrl: string,
  redirects = 0,
): Promise<{ res: Response; finalUrl: string }> {
  const url = await validatePublicHttpUrl(rawUrl);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "mcp-web-basics/1.0" },
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status >= 300 && res.status < 400) {
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
    const location = res.headers.get("location");
    if (!location) throw new Error("Redirect missing location");
    return fetchPublicHttpUrl(new URL(location, url).toString(), redirects + 1);
  }

  return { res, finalUrl: url.toString() };
}

export async function readBytesCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(res.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("Body too large");
  if (!res.body) return new Uint8Array();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Body too large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function validatePublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw validationError("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw validationError("Unsupported protocol");
  }
  if (url.username || url.password) {
    throw validationError("Credentials not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw validationError("Private hostnames not allowed");
  }

  const records = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (records.length === 0) {
    throw validationError("DNS resolution failed");
  }
  if (
    records.some((record) => {
      try {
        return ipaddr.process(record.address).range() !== "unicast";
      } catch {
        return true;
      }
    })
  ) {
    throw validationError("Private address resolved");
  }

  return url;
}
