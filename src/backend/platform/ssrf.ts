/**
 * SSRF guard for the exhibit fetch pipeline.
 *
 * Exhibit source URLs come from AI generation (web_search results, dataset metadata,
 * admin input) → they are UNTRUSTED. Without this guard a hallucinated or malicious
 * URL could make our server fetch `http://169.254.169.254/` (cloud metadata) or a
 * private/internal address. `assertPublicUrl` resolves the host and rejects anything
 * that is not a public unicast address. It is revalidated on EVERY redirect hop by
 * the fetcher (a 302 to an internal address is the classic bypass).
 *
 * Known limitation (documented, not fixed in V1): a DNS-rebinding window exists
 * between this lookup and the actual socket connect. Hardening (pin the validated
 * IP and connect to it while keeping the original Host header via a custom undici
 * dispatcher) is a future improvement; for legal source fetching the pre-flight
 * check is the pragmatic baseline.
 */

import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

export type HostLookup = (hostname: string) => Promise<{ address: string; family: number }>;

/** True only for a globally-routable public unicast address. Everything else
 *  (private, loopback, link-local, unique-local, reserved, ipv4-mapped, teredo,
 *  6to4, multicast, broadcast…) is rejected. */
function isPublicAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.process(address); // unwraps ipv4-mapped IPv6 to IPv4
  } catch {
    return false;
  }
  return parsed.range() === "unicast";
}

/**
 * Throws SsrfError unless `raw` is an http(s) URL whose host resolves to a public
 * address. `lookup` is injectable for tests (defaults to node DNS).
 */
export async function assertPublicUrl(
  raw: string,
  opts: { lookup?: HostLookup } = {},
): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SsrfError(`invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SsrfError(`scheme not allowed: ${u.protocol}`);
  }

  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // Host is already an IP literal → check it directly (no DNS).
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new SsrfError(`non-public address: ${host}`);
    return;
  }

  const lookup = opts.lookup ?? ((h: string) => dns.lookup(h));
  let resolved: { address: string; family: number };
  try {
    resolved = await lookup(host);
  } catch {
    throw new SsrfError(`DNS resolution failed for ${host}`);
  }
  if (!isPublicAddress(resolved.address)) {
    throw new SsrfError(`host ${host} resolves to a non-public address (${resolved.address})`);
  }
}
