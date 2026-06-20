/**
 * Rate limiting — DOC-22 §1.6, DOC-27 §4.
 *
 * Uses @upstash/ratelimit (sliding window) backed by Upstash Redis.
 *
 * Fail mode (DOC-27 §4):
 *   - Auth endpoints (OTP, staff login): CLOSED — deny when Upstash is down.
 *   - Authenticated API: OPEN — allow when Upstash is down.
 *
 * Dev fallback:
 *   When UPSTASH_REDIS_REST_URL / _TOKEN are absent AND NODE_ENV=development,
 *   the limiter falls back to an in-memory ephemeralCache map that enforces
 *   the same limits. A single warning is emitted at first call.
 *   In production without Upstash configured: hard throw (fail fast).
 *
 * Multiple windows per key (DOC-22 §1.6 requires 3 tiers for otp:send:phone):
 *   We create one Ratelimit instance per window and check all of them in
 *   sequence. The first one that denies causes a 429.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { providerEnv } from "./env";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Redis factory — with dev in-memory fallback
// ---------------------------------------------------------------------------

let devFallbackWarned = false;

function getRedis(): Redis | null {
  try {
    const cfg = providerEnv("upstashRedis");
    return new Redis({ url: cfg.UPSTASH_REDIS_REST_URL, token: cfg.UPSTASH_REDIS_REST_TOKEN });
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Upstash Redis is required in production for rate limiting. " +
          "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. See DOC-82.",
      );
    }
    // Development fallback: return null, callers use in-memory limiters
    if (!devFallbackWarned) {
      devFallbackWarned = true;
      logger.warn(
        {},
        "Upstash not configured — in-memory dev fallback for rate limiting. " +
          "This fallback is NOT suitable for production (no cross-process/cross-request state).",
      );
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Limiter factory helpers
// ---------------------------------------------------------------------------

/**
 * Creates a sliding-window Ratelimit instance.
 * When redis is null (dev fallback) an in-memory ephemeralCache map is used.
 * In dev mode the limiter still enforces limits within the same serverless
 * function lifetime; across cold starts it resets (acceptable for dev).
 */
function makeLimiter(
  redis: Redis | null,
  tokens: number,
  window: string,
  prefix: string,
): Ratelimit {
  if (redis) {
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(tokens, window as Parameters<typeof Ratelimit.slidingWindow>[1]),
      prefix,
    });
  }

  // Dev in-memory fallback: use an ephemeral Map as the "redis" store.
  // The Ratelimit type expects a Redis instance but in dev we bypass real
  // network calls by providing an in-process store via ephemeralCache.
  // We create a real Ratelimit with a dummy redis that will never be called
  // because the ephemeralCache will short-circuit hits.
  //
  // Actually @upstash/ratelimit doesn't offer a pure in-memory mode, so we
  // implement a lightweight wrapper that mimics the Ratelimit interface using
  // a Map<identifier, { count: number; windowStart: number }>.
  const store = new Map<string, { count: number; windowStart: number }>();
  const windowMs = parseWindowMs(window);

  return {
    limit: async (identifier: string) => {
      const now = Date.now();
      const entry = store.get(identifier);
      const windowStart = entry && now - entry.windowStart < windowMs ? entry.windowStart : now;
      const count = entry && now - entry.windowStart < windowMs ? entry.count + 1 : 1;
      store.set(identifier, { count, windowStart });
      const reset = windowStart + windowMs;
      const remaining = Math.max(0, tokens - count);
      const success = count <= tokens;
      return { success, limit: tokens, remaining, reset, pending: Promise.resolve() };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function parseWindowMs(window: string): number {
  const match = window.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid window format: ${window}`);
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    default: throw new Error(`Unknown unit: ${match[2]}`);
  }
}

// ---------------------------------------------------------------------------
// Limiter instances (module-level singletons — created once per cold start)
// ---------------------------------------------------------------------------

// Lazy-init pattern: redis is resolved on first call to avoid boot-time throws
// when Upstash is not yet configured (phase-by-phase wiring per DOC-80).
let _redis: Redis | null | undefined; // undefined = not yet resolved

function redis(): Redis | null {
  if (_redis === undefined) _redis = getRedis();
  return _redis;
}

// otp:send:phone — 3 tiers (DOC-22 §1.6): 1/45s · 5/h · 8/d
let _otpSendPhone45s: Ratelimit | undefined;
let _otpSendPhone1h: Ratelimit | undefined;
let _otpSendPhone1d: Ratelimit | undefined;

function otpSendPhone45s(): Ratelimit {
  return (_otpSendPhone45s ??= makeLimiter(redis(), 1, "45 s", "rl:otp:send:phone:45s"));
}
function otpSendPhone1h(): Ratelimit {
  return (_otpSendPhone1h ??= makeLimiter(redis(), 5, "1 h", "rl:otp:send:phone:1h"));
}
function otpSendPhone1d(): Ratelimit {
  return (_otpSendPhone1d ??= makeLimiter(redis(), 8, "1 d", "rl:otp:send:phone:1d"));
}

// otp:send:ip — 2 tiers (DOC-22 §1.6 / DOC-27 §4): 10/h · 30/d
let _otpSendIp1h: Ratelimit | undefined;
let _otpSendIp1d: Ratelimit | undefined;

function otpSendIp1h(): Ratelimit {
  return (_otpSendIp1h ??= makeLimiter(redis(), 10, "1 h", "rl:otp:send:ip:1h"));
}
function otpSendIp1d(): Ratelimit {
  return (_otpSendIp1d ??= makeLimiter(redis(), 30, "1 d", "rl:otp:send:ip:1d"));
}

// otp:verify:phone — 10/h (DOC-22 §1.6)
let _otpVerifyPhone1h: Ratelimit | undefined;
function otpVerifyPhone1h(): Ratelimit {
  return (_otpVerifyPhone1h ??= makeLimiter(redis(), 10, "1 h", "rl:otp:verify:phone:1h"));
}

// otp:send:email — 3 tiers (DOC-22 §1, email auth): 1/45s · 5/h · 8/d
let _otpSendEmail45s: Ratelimit | undefined;
let _otpSendEmail1h: Ratelimit | undefined;
let _otpSendEmail1d: Ratelimit | undefined;

function otpSendEmail45s(): Ratelimit {
  return (_otpSendEmail45s ??= makeLimiter(redis(), 1, "45 s", "rl:otp:send:email:45s"));
}
function otpSendEmail1h(): Ratelimit {
  return (_otpSendEmail1h ??= makeLimiter(redis(), 5, "1 h", "rl:otp:send:email:1h"));
}
function otpSendEmail1d(): Ratelimit {
  return (_otpSendEmail1d ??= makeLimiter(redis(), 8, "1 d", "rl:otp:send:email:1d"));
}

// otp:verify:email — 10/h (DOC-22 §1)
let _otpVerifyEmail1h: Ratelimit | undefined;
function otpVerifyEmail1h(): Ratelimit {
  return (_otpVerifyEmail1h ??= makeLimiter(redis(), 10, "1 h", "rl:otp:verify:email:1h"));
}

// staff:login — 5/15min per email+ip (DOC-27 §4)
let _staffLogin: Ratelimit | undefined;
function staffLogin(): Ratelimit {
  return (_staffLogin ??= makeLimiter(redis(), 5, "15 m", "rl:staff:login"));
}

// signing:token:ip — 30/h (DOC-27 §4; consumed by the /firma/[token] flow in F1+)
let _signingTokenIp: Ratelimit | undefined;
function signingTokenIp(): Ratelimit {
  return (_signingTokenIp ??= makeLimiter(redis(), 30, "1 h", "rl:signing:token:ip"));
}

// express-interest:ip — 60/min (DOC-27 §4; public surface for API-LEAD-08)
// Fail mode: closed — public endpoint with no auth guard on the service itself.
let _expressInterestIp: Ratelimit | undefined;
function expressInterestIp(): Ratelimit {
  return (_expressInterestIp ??= makeLimiter(redis(), 60, "1 m", "rl:express-interest:ip"));
}

// billing:checkout — 5/min per userId (DOC-71 §7, HIGH-3)
// Limits concurrent checkout session creation. Fail mode: open (authenticated endpoint).
let _billingCheckout: Ratelimit | undefined;
function billingCheckout(): Ratelimit {
  return (_billingCheckout ??= makeLimiter(redis(), 5, "1 m", "rl:billing:checkout"));
}

// billing:uploadUrl — 10/min per userId (DOC-71 §7, HIGH-3)
// Limits signed upload URL generation for Zelle proofs. Fail mode: open (authenticated).
let _billingUploadUrl: Ratelimit | undefined;
function billingUploadUrl(): Ratelimit {
  return (_billingUploadUrl ??= makeLimiter(redis(), 10, "1 m", "rl:billing:uploadUrl"));
}

let _messagingUploadUrl: Ratelimit | undefined;
function messagingUploadUrl(): Ratelimit {
  return (_messagingUploadUrl ??= makeLimiter(redis(), 10, "1 m", "rl:messaging:uploadUrl"));
}

// ---------------------------------------------------------------------------
// Public rate-limit helpers
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  /** Unix ms timestamp when the limit resets (for Retry-After header). */
  reset: number;
}

/**
 * Checks all OTP send phone tiers (1/45s · 5/h · 8/d).
 * Returns `allowed: false` if ANY tier denies.
 * Fail mode: closed (deny on error) — auth endpoint.
 */
export async function limitOtpSendPhone(phoneE164: string): Promise<RateLimitResult> {
  try {
    const key = phoneE164;
    // Sequential on purpose: a denial at a short tier must NOT consume quota
    // from the longer tiers (a burst denied at 45s would otherwise exhaust
    // the hourly budget without sending a single SMS). ~2 extra serial Redis
    // round-trips on the hot path — imperceptible under the 800ms floor.
    const r45s = await otpSendPhone45s().limit(key);
    if (!r45s.success) return { allowed: false, reset: r45s.reset };
    const r1h = await otpSendPhone1h().limit(key);
    if (!r1h.success) return { allowed: false, reset: r1h.reset };
    const r1d = await otpSendPhone1d().limit(key);
    if (!r1d.success) return { allowed: false, reset: r1d.reset };
    return { allowed: true, reset: 0 };
  } catch (err) {
    logger.error({ err }, "Rate limiter error (otp:send:phone) — denying (closed fail mode)");
    return { allowed: false, reset: Date.now() + 60_000 };
  }
}

/**
 * Checks all OTP send IP tiers (10/h · 30/d).
 * Fail mode: closed.
 */
export async function limitOtpSendIp(ip: string): Promise<RateLimitResult> {
  try {
    // Sequential — see limitOtpSendPhone for rationale.
    const r1h = await otpSendIp1h().limit(ip);
    if (!r1h.success) return { allowed: false, reset: r1h.reset };
    const r1d = await otpSendIp1d().limit(ip);
    if (!r1d.success) return { allowed: false, reset: r1d.reset };
    return { allowed: true, reset: 0 };
  } catch (err) {
    logger.error({ err }, "Rate limiter error (otp:send:ip) — denying (closed fail mode)");
    return { allowed: false, reset: Date.now() + 60_000 };
  }
}

/**
 * Checks all OTP send EMAIL tiers (1/45s · 5/h · 8/d) — client email auth.
 * Sequential (see limitOtpSendPhone for rationale). Fail mode: closed.
 */
export async function limitOtpSendEmail(email: string): Promise<RateLimitResult> {
  try {
    const r45s = await otpSendEmail45s().limit(email);
    if (!r45s.success) return { allowed: false, reset: r45s.reset };
    const r1h = await otpSendEmail1h().limit(email);
    if (!r1h.success) return { allowed: false, reset: r1h.reset };
    const r1d = await otpSendEmail1d().limit(email);
    if (!r1d.success) return { allowed: false, reset: r1d.reset };
    return { allowed: true, reset: 0 };
  } catch (err) {
    logger.error({ err }, "Rate limiter error (otp:send:email) — denying (closed fail mode)");
    return { allowed: false, reset: Date.now() + 60_000 };
  }
}

/**
 * Checks OTP verify EMAIL tier (10/h). Fail mode: closed.
 */
export async function limitOtpVerifyEmail(email: string): Promise<RateLimitResult> {
  try {
    const r = await otpVerifyEmail1h().limit(email);
    return { allowed: r.success, reset: r.reset };
  } catch (err) {
    logger.error({ err }, "Rate limiter error (otp:verify:email) — denying (closed fail mode)");
    return { allowed: false, reset: Date.now() + 60_000 };
  }
}

/**
 * Checks OTP verify phone tier (10/h).
 * Fail mode: closed.
 */
export async function limitOtpVerifyPhone(phoneE164: string): Promise<RateLimitResult> {
  try {
    const r = await otpVerifyPhone1h().limit(phoneE164);
    return { allowed: r.success, reset: r.reset };
  } catch (err) {
    logger.error({ err }, "Rate limiter error (otp:verify:phone) — denying (closed fail mode)");
    return { allowed: false, reset: Date.now() + 60_000 };
  }
}

/**
 * Checks staff login tier (5/15 min per email+ip combo).
 * Fail mode: closed.
 */
export async function limitStaffLogin(email: string, ip: string): Promise<RateLimitResult> {
  try {
    const key = `${email}:${ip}`;
    const r = await staffLogin().limit(key);
    return { allowed: r.success, reset: r.reset };
  } catch (err) {
    logger.error({ err }, "Rate limiter error (staff:login) — denying (closed fail mode)");
    return { allowed: false, reset: Date.now() + 60_000 };
  }
}

/**
 * Checks signing token IP tier (30/h, DOC-27 §4) — public /firma/[token] flow.
 * Fail mode: closed.
 */
export async function limitSigningTokenIp(ip: string): Promise<RateLimitResult> {
  try {
    const r = await signingTokenIp().limit(ip);
    return { allowed: r.success, reset: r.reset };
  } catch (err) {
    logger.error({ err }, "Rate limiter error (signing:token:ip) — denying (closed fail mode)");
    return { allowed: false, reset: Date.now() + 60_000 };
  }
}

/**
 * Checks express-interest IP tier (60/min, DOC-27 §4) — API-LEAD-08 public CTA.
 *
 * IMPORTANT: This limiter must be applied in the CALL SITE (the Next.js route
 * handler or server action that calls kanban.expressServiceInterest). The
 * service itself has no actor context, so IP is the only available key.
 *
 * Usage in the action:
 *   const ip = headers().get("x-forwarded-for") ?? "unknown";
 *   const rl = await limitExpressInterestIp(ip);
 *   if (!rl.allowed) return { ok: false, error: { code: "RATE_LIMITED" } };
 *
 * TODO(API-LEAD-08): When the CTA is behind a feature-flag and the server action
 * is created, wire limitExpressInterestIp() as the FIRST check before calling
 * expressServiceInterest(). Fail mode: closed (deny on Upstash error).
 *
 * Fail mode: closed.
 */
export async function limitExpressInterestIp(ip: string): Promise<RateLimitResult> {
  try {
    const r = await expressInterestIp().limit(ip);
    return { allowed: r.success, reset: r.reset };
  } catch (err) {
    logger.error({ err }, "Rate limiter error (express-interest:ip) — denying (closed fail mode)");
    return { allowed: false, reset: Date.now() + 60_000 };
  }
}

/**
 * Checks billing checkout tier (5/min per userId, DOC-71 §7 HIGH-3).
 *
 * Limits concurrent Stripe Checkout session creation per user. Applied at the
 * server action (createInstallmentCheckoutAction) BEFORE calling the service.
 *
 * Fail mode: open (authenticated endpoint — deny on error only for security-critical
 * unauthenticated surfaces). If Upstash is unavailable, allow the checkout to proceed.
 */
export async function limitBillingCheckout(userId: string): Promise<RateLimitResult> {
  try {
    const r = await billingCheckout().limit(userId);
    return { allowed: r.success, reset: r.reset };
  } catch (err) {
    logger.warn({ err }, "Rate limiter error (billing:checkout) — allowing (open fail mode)");
    return { allowed: true, reset: 0 };
  }
}

/**
 * Checks billing upload-url tier (10/min per userId, DOC-71 §7 HIGH-3).
 *
 * Limits signed upload URL generation for Zelle proofs. Applied at the route
 * handler (POST /api/v1/installments/[id]/zelle-proof/upload-url) before calling
 * the service.
 *
 * Fail mode: open (authenticated endpoint — same rationale as limitBillingCheckout).
 */
export async function limitBillingUploadUrl(userId: string): Promise<RateLimitResult> {
  try {
    const r = await billingUploadUrl().limit(userId);
    return { allowed: r.success, reset: r.reset };
  } catch (err) {
    logger.warn({ err }, "Rate limiter error (billing:uploadUrl) — allowing (open fail mode)");
    return { allowed: true, reset: 0 };
  }
}

/** Chat attachment signed-URL generation: 10/min per user, fail-open (DOC-46). */
export async function limitMessagingUploadUrl(userId: string): Promise<RateLimitResult> {
  try {
    const r = await messagingUploadUrl().limit(userId);
    return { allowed: r.success, reset: r.reset };
  } catch (err) {
    logger.warn({ err }, "Rate limiter error (messaging:uploadUrl) — allowing (open fail mode)");
    return { allowed: true, reset: 0 };
  }
}
