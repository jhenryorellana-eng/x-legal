/**
 * Public URL helpers shared across layers (app → shared, platform → shared).
 *
 * Framework-agnostic on purpose: callers pass the request signals (headers) and
 * this module owns the canonical origin and the loopback guard, so an absolute
 * link built server-side is NEVER left pointing at a localhost host (unreachable
 * from a phone / another browser / the client). This is the same guarantee
 * `emailBaseUrl()` gives emails, generalized so copyable links get it too.
 */

/** Canonical public origin (no trailing slash). Matches emails + identity links. */
export const CANONICAL_ORIGIN = "https://x-legal.usalatinoprime.com";

/** Matches a loopback/localhost origin — never a valid public link target. */
export const LOOPBACK_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/i;

/** True when a URL/origin string is empty/absent or points at a loopback host. */
export function isLoopbackOrigin(url: string | null | undefined): boolean {
  return !url || LOOPBACK_ORIGIN.test(url);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/** Host (incl. port) of a URL string, lowercased; null if unparseable. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Relative path of the public contract-signing page for a token. */
export function signingLinkPath(token: string): string {
  return `/firma/${token}`;
}

/**
 * Resolves the public origin for absolute links built server-side.
 *
 * SECURITY: the request host (`x-forwarded-host`/`host`) is attacker-influenceable,
 * and these links carry a real signing token that gets copied/emailed to a client —
 * so the request host is trusted ONLY when it matches an allow-list of known-good
 * public hosts (the canonical prod host + the configured `NEXT_PUBLIC_APP_URL`
 * host). Any other value (spoofed header, a 401-gated Vercel preview host, a
 * loopback host) is ignored and we fall back to the env origin, then the canonical
 * origin. The result is always a trusted, reachable public origin (no trailing
 * slash). Callers pass plain header strings — this stays framework-agnostic.
 */
export function resolveAppOrigin(signals: {
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  host?: string | null;
  envUrl?: string | null;
}): string {
  const envUrl =
    signals.envUrl && !isLoopbackOrigin(signals.envUrl)
      ? stripTrailingSlash(signals.envUrl)
      : null;

  // Allow-list of hosts we trust to serve this app publicly.
  const allowed = new Set<string>();
  const canonicalHost = hostOf(CANONICAL_ORIGIN);
  if (canonicalHost) allowed.add(canonicalHost);
  if (envUrl) {
    const envHost = hostOf(envUrl);
    if (envHost) allowed.add(envHost);
  }

  const requestHost = (signals.forwardedHost || signals.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (requestHost && allowed.has(requestHost)) {
    const proto = signals.forwardedProto?.split(",")[0]?.trim() || "https";
    return `${proto}://${requestHost}`;
  }

  // Request host is absent/untrusted → known-good fallbacks only.
  return envUrl ?? CANONICAL_ORIGIN;
}

/** Absolute URL for a relative path against the resolved app origin. */
export function absoluteAppUrl(
  path: string,
  signals: Parameters<typeof resolveAppOrigin>[0],
): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = resolveAppOrigin(signals);
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
