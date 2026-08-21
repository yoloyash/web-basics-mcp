import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { validationError } from "./errors.js";

export const DEFAULT_USER_AGENT = "mcp-web-basics/1.0";

const FETCH_TIMEOUT_MS = 10000;
const DEFAULT_MAX_REDIRECTS = 5;
const MAX_TRANSIENT_RETRIES = 1;
const RETRY_DELAY_MS = 250;
const TIMEOUT_NAMES = new Set(["AbortError", "TimeoutError"]);
const NETWORK_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH"]);
const NETWORK_MESSAGES = new Set([
  "fetch failed",
  "network request failed",
  "socket hang up",
]);

type FetchLike = typeof globalThis.fetch;
type LookupHost = (hostname: string) => Promise<LookupAddress[]>;

export interface FetchPublicHttpOptions {
  fetchImpl?: FetchLike;
  headers?: Record<string, string>;
  lookupHost?: LookupHost;
  maxRedirects?: number;
  maxTransientRetries?: number;
  retryDelayMs?: number;
  retryDelayForResponse?: (response: Response, attempt: number) => number;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
  validatePublicAddress?: boolean;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface FetchConfig {
  fetchImpl: FetchLike;
  headers: Record<string, string>;
  lookupHost: LookupHost;
  maxRedirects: number;
  maxTransientRetries: number;
  retryDelayMs: number;
  retryDelayForResponse?: (response: Response, attempt: number) => number;
  signal?: AbortSignal;
  timeoutMs: number;
  userAgent: string;
  validatePublicAddress: boolean;
  wait: (ms: number, signal?: AbortSignal) => Promise<void>;
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
  const url = await validatePublicHttpUrl(
    rawUrl,
    config.lookupHost,
    config.validatePublicAddress,
    config.signal,
  );

  for (let attempt = 0; attempt <= config.maxTransientRetries; attempt += 1) {
    let res: Response;
    try {
      res = await config.fetchImpl(url.toString(), {
        headers: requestHeaders(config),
        redirect: "manual",
        signal: requestSignal(config),
      });
    } catch (err) {
      config.signal?.throwIfAborted();
      if (!shouldRetryFetchError(err, attempt, config.maxTransientRetries)) throw err;
      await config.wait(config.retryDelayMs, config.signal);
      continue;
    }

    if (res.status >= 300 && res.status < 400) {
      if (redirects >= config.maxRedirects) throw new Error("Too many redirects");
      const location = res.headers.get("location");
      if (!location) throw new Error("Redirect missing location");
      return fetchPublicHttpUrlWithRedirects(new URL(location, url).toString(), config, redirects + 1);
    }

    if (!res.ok) {
      if (isRetryableHttpStatus(res.status) && attempt < config.maxTransientRetries) {
        const delayMs = config.retryDelayForResponse?.(res, attempt) ?? config.retryDelayMs;
        await config.wait(delayMs, config.signal);
        continue;
      }
      throw new HttpStatusError(res.status);
    }

    return { res, finalUrl: url.toString() };
  }

  throw new Error("Failed to fetch URL");
}

export async function readBytesCapped(
  res: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const declaredLength = Number(res.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("Body too large");
  if (!res.body) return new Uint8Array();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    if (signal?.aborted) {
      await reader.cancel(signal.reason);
      signal.throwIfAborted();
    }
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
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    headers: options.headers ?? {},
    lookupHost: options.lookupHost ?? lookupHost,
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    maxTransientRetries: options.maxTransientRetries ?? MAX_TRANSIENT_RETRIES,
    retryDelayMs: options.retryDelayMs ?? RETRY_DELAY_MS,
    retryDelayForResponse: options.retryDelayForResponse,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? FETCH_TIMEOUT_MS,
    userAgent: options.userAgent?.trim() || DEFAULT_USER_AGENT,
    validatePublicAddress: options.validatePublicAddress ?? true,
    wait: options.wait ?? wait,
  };
}

function requestHeaders(config: FetchConfig): Record<string, string> {
  const { "User-Agent": _upperUserAgent, "user-agent": _lowerUserAgent, ...headers } = config.headers;
  return { "User-Agent": config.userAgent, ...headers };
}

function requestSignal(config: FetchConfig): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
  return config.signal
    ? AbortSignal.any([config.signal, timeoutSignal])
    : timeoutSignal;
}

async function lookupHost(hostname: string): Promise<LookupAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const timeout = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    function finish() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function shouldRetryFetchError(err: unknown, attempt: number, maxTransientRetries: number): boolean {
  return attempt < maxTransientRetries && isTransientFetchError(err);
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

async function validatePublicHttpUrl(
  rawUrl: string,
  lookupAddresses: LookupHost,
  validatePublicAddress: boolean,
  signal?: AbortSignal,
): Promise<URL> {
  signal?.throwIfAborted();
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

  if (!validatePublicAddress) return url;

  const records = await lookupAddresses(hostname).catch(() => []);
  signal?.throwIfAborted();
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
