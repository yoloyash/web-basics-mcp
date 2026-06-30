import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { validationError } from "./errors.js";
import { fetch } from "./fetch.js";

export const DEFAULT_USER_AGENT = "mcp-web-basics/1.0";

const FETCH_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const MAX_TRANSIENT_RETRIES = 1;
const RETRY_DELAY_MS = 250;
const TIMEOUT_NAMES = new Set(["AbortError", "TimeoutError"]);
const NETWORK_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH"]);
const NETWORK_MESSAGES = new Set([
  "fetch failed",
  "network request failed",
  "socket hang up",
]);

type FetchLike = typeof fetch;
type LookupHost = (hostname: string) => Promise<LookupAddress[]>;

export interface FetchPublicHttpOptions {
  fetchImpl?: FetchLike;
  lookupHost?: LookupHost;
  retryDelayMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  wait?: (ms: number) => Promise<void>;
}

interface FetchConfig {
  fetchImpl: FetchLike;
  lookupHost: LookupHost;
  retryDelayMs: number;
  timeoutMs: number;
  userAgent: string;
  wait: (ms: number) => Promise<void>;
}

export class HttpStatusError extends Error {
  readonly retryable: boolean;
  readonly status: number;

  constructor(status: number) {
    super(`HTTP status ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.retryable = isRetryableHttpStatus(status);
  }
}

export function resolveUserAgent(env: Record<string, string | undefined> = process.env): string {
  return env.WEB_BASICS_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
}

export async function fetchPublicHttpUrl(
  rawUrl: string,
  options: FetchPublicHttpOptions = {},
): Promise<{ res: Response; finalUrl: string }> {
  return fetchPublicHttpUrlWithRedirects(rawUrl, normalizeFetchOptions(options), 0);
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchPublicHttpUrlWithRedirects(
  rawUrl: string,
  config: FetchConfig,
  redirects: number,
): Promise<{ res: Response; finalUrl: string }> {
  const url = await validatePublicHttpUrl(rawUrl, config.lookupHost);

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    let res: Response;
    try {
      res = await config.fetchImpl(url.toString(), {
        headers: { "User-Agent": config.userAgent },
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      if (!shouldRetryFetchError(err, attempt)) throw err;
      await config.wait(config.retryDelayMs);
      continue;
    }

    if (res.status >= 300 && res.status < 400) {
      if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
      const location = res.headers.get("location");
      if (!location) throw new Error("Redirect missing location");
      return fetchPublicHttpUrlWithRedirects(new URL(location, url).toString(), config, redirects + 1);
    }

    if (!res.ok) {
      if (isRetryableHttpStatus(res.status) && attempt < MAX_TRANSIENT_RETRIES) {
        await config.wait(config.retryDelayMs);
        continue;
      }
      throw new HttpStatusError(res.status);
    }

    return { res, finalUrl: url.toString() };
  }

  throw new Error("Failed to fetch URL");
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

function normalizeFetchOptions(options: FetchPublicHttpOptions): FetchConfig {
  return {
    fetchImpl: options.fetchImpl ?? fetch,
    lookupHost: options.lookupHost ?? lookupHost,
    retryDelayMs: options.retryDelayMs ?? RETRY_DELAY_MS,
    timeoutMs: options.timeoutMs ?? FETCH_TIMEOUT_MS,
    userAgent: options.userAgent?.trim() || resolveUserAgent(),
    wait: options.wait ?? wait,
  };
}

async function lookupHost(hostname: string): Promise<LookupAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryFetchError(err: unknown, attempt: number): boolean {
  return attempt < MAX_TRANSIENT_RETRIES && isTransientFetchError(err);
}

function isTransientFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;

  return (
    TIMEOUT_NAMES.has(name) ||
    (typeof code === "string" && NETWORK_CODES.has(code)) ||
    NETWORK_MESSAGES.has(msg.toLowerCase())
  );
}

async function validatePublicHttpUrl(rawUrl: string, lookupAddresses: LookupHost): Promise<URL> {
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

  const records = await lookupAddresses(hostname).catch(() => []);
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
