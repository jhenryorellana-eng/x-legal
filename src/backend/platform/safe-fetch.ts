/**
 * safeFetch — SSRF-safe HTTP fetch for the exhibit pipeline.
 *
 * Wraps fetch with: a hard AbortController timeout, MANUAL redirect handling that
 * re-runs the SSRF guard on every hop (a 302 to an internal address is the classic
 * bypass), and a bot-identifying User-Agent. Used to probe content-type and to
 * download PDF/image sources directly; HTML sources go to the Renderer instead.
 */

import { assertPublicUrl, type HostLookup } from "./ssrf";

export class RetryableFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableFetchError";
  }
}

export class NonRetryableFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableFetchError";
  }
}

const DEFAULT_UA = "USALatinoPrimeBot/2.0 (+https://usalatinoprime.com/bot)";
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  fetchFn?: typeof fetch;
  lookup?: HostLookup;
  userAgent?: string;
}

/**
 * Fetches `url`, following up to `maxRedirects` redirects, re-validating each hop
 * as a public address first. Throws SsrfError (from assertPublicUrl) on a
 * non-public hop, NonRetryableFetchError on redirect loops/limits, and
 * RetryableFetchError on a malformed redirect.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 25_000, maxRedirects = 5, fetchFn = fetch, lookup, userAgent = DEFAULT_UA } = opts;
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current, { lookup }); // revalidate on EVERY hop

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": userAgent, accept: "text/html,application/pdf,image/*,*/*" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (REDIRECT_CODES.has(res.status)) {
      const loc = res.headers.get("location");
      res.body?.cancel().catch(() => {});
      if (!loc) throw new RetryableFetchError("redirect without Location header");
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new NonRetryableFetchError("too many redirects");
}
