/**
 * URL reachability check — verifies that a public source link actually resolves
 * before it goes into the annexes, so each exhibit link can be downloaded and
 * printed as a physical piece of the expediente (Henry's hard requirement). Only
 * sources whose URL resolves are kept as verified exhibits.
 */

export function isLikelyUrl(value: string): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export interface UrlCheckResult {
  url: string;
  reachable: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Best-effort reachability probe. HEAD first (cheap); falls back to GET when the
 * server rejects HEAD (405/501/403, common on news sites with bot protection).
 * Network errors and timeouts resolve to `reachable:false` — never throws.
 */
export async function checkUrlReachable(
  url: string,
  opts: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<UrlCheckResult> {
  if (!isLikelyUrl(url)) return { url, reachable: false, error: "invalid_url" };
  const doFetch = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 6000;

  const attempt = async (method: "HEAD" | "GET") => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await doFetch(url, { method, redirect: "follow", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let res = await attempt("HEAD");
    if (!res.ok && (res.status === 405 || res.status === 501 || res.status === 403)) {
      res.body?.cancel().catch(() => {}); // release the HEAD socket before the GET
      res = await attempt("GET");
    }
    const result = { url, reachable: res.ok, statusCode: res.status };
    res.body?.cancel().catch(() => {}); // we only need the status — free the socket
    return result;
  } catch (err) {
    return { url, reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Verifies a list of URL-bearing items in parallel, returning only those whose
 * URL resolves. Items without a URL are dropped (a court exhibit needs a real,
 * downloadable source). Bounded concurrency is unnecessary at these volumes
 * (≤ ~12 sources per letter).
 */
export async function keepReachable<T extends { url: string }>(
  items: T[],
  opts: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<T[]> {
  const checks = await Promise.all(
    items.map(async (it) => ({ it, ok: it.url ? (await checkUrlReachable(it.url, opts)).reachable : false })),
  );
  return checks.filter((c) => c.ok).map((c) => c.it);
}
