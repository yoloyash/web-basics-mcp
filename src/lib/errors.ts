export interface ClassifiedError {
  category: "validation" | "network" | "http" | "timeout" | "parse";
  message: string;
  retryable?: boolean;
}

const TIMEOUT_NAMES = new Set(["AbortError", "TimeoutError"]);
const NETWORK_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH"]);

const NETWORK_MESSAGES = new Set([
  "fetch failed",
  "network request failed",
  "socket hang up",
]);

export function validationError(message: string): Error {
  const err = new Error(message);
  err.name = "ValidationError";
  return err;
}

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof Error && err.name === "ValidationError") {
    return { category: "validation", message: err.message };
  }

  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
  const retryable =
    typeof err === "object" && err !== null && "retryable" in err && typeof err.retryable === "boolean"
      ? err.retryable
      : undefined;

  if (TIMEOUT_NAMES.has(name)) {
    return { category: "timeout", message: `Request timed out: ${msg}`, retryable: retryable ?? true };
  }

  const httpStatusMatch = msg.match(/\b(?:HTTP\s*)?(?:status(?: code)?|error: status)\s+(\d{3})\b/i);
  if (httpStatusMatch) {
    const status = Number(httpStatusMatch[1]);
    return { category: "http", message: msg, retryable: retryable ?? (status === 429 || status >= 500) };
  }

  if (typeof code === "string" && NETWORK_CODES.has(code)) {
    return { category: "network", message: `Cannot connect: ${msg}`, retryable: retryable ?? true };
  }
  if (NETWORK_MESSAGES.has(msg.toLowerCase())) {
    return { category: "network", message: `Cannot connect: ${msg}`, retryable: retryable ?? true };
  }

  if (msg === "Body too large") {
    return { category: "validation", message: msg, retryable: false };
  }

  if (/parse|invalid xml|unexpected token|malformed/i.test(msg)) {
    return { category: "parse", message: `Failed to parse response: ${msg}` };
  }

  return { category: "network", message: `Unexpected error: ${msg}` };
}
