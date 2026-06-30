import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";

/**
 * Configure undici to respect HTTP_PROXY, HTTPS_PROXY, and NO_PROXY
 * environment variables. Only active when at least one proxy variable
 * is set. Idempotent: safe to call multiple times.
 */
export function initProxy(): void {
  const httpProxy = envValue("http_proxy", "HTTP_PROXY");
  const httpsProxy = envValue("https_proxy", "HTTPS_PROXY");
  const noProxy = envValue("no_proxy", "NO_PROXY");
  if (!httpProxy && !httpsProxy) {
    return;
  }

  setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy }));
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}
