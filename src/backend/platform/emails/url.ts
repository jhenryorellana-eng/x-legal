/**
 * Public base URL for emails (DOC-73).
 *
 * Emails are external: a link/logo that points at localhost is ALWAYS wrong (it
 * is unreachable from a mail client). So the email base URL prefers
 * NEXT_PUBLIC_APP_URL but falls back to the canonical production origin whenever
 * that value is missing or points at a loopback host — e.g. an email sent from
 * local dev, a preview deploy, or a misconfigured env. In production
 * NEXT_PUBLIC_APP_URL is the prod origin, so this is a no-op there.
 *
 * Canonical origin matches the fallback already used in identity/service.ts.
 */

import { env } from "../env";
import { CANONICAL_ORIGIN, isLoopbackOrigin } from "@/shared/urls";

/** Resolves the origin to use in email links/assets (never a loopback host). */
export function emailBaseUrl(): string {
  const configured = env.NEXT_PUBLIC_APP_URL;
  if (isLoopbackOrigin(configured)) return CANONICAL_ORIGIN;
  return configured.replace(/\/$/, "");
}

/** Resolves a relative deep-link path to an absolute URL on the email origin. */
export function emailAbsoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${emailBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
