/**
 * Next.js middleware — session refresh + surface guards (DOC-22 §5.4).
 *
 * Runs on every matched request (see `config.matcher` below).
 *
 * Responsibilities:
 * 1. Refresh the Supabase session (access token + cookies) on every request.
 *    Required because Server Components cannot set cookies; the middleware
 *    must do it so RSCs downstream see a fresh session.
 * 2. Surface guard: redirect unauthenticated / wrong-kind users.
 *
 * Claims strategy (DOC-22 §3, decision made June 2026):
 *   `getClaims()` validates the JWT against the project's JWKS endpoint
 *   (cached, ~1 network call / JWT until it expires) and returns the full
 *   JWT payload INCLUDING custom claims from the Custom Access Token Hook.
 *   This is preferred over `getUser()` (which always hits the Auth server)
 *   for middleware performance, and over `getSession()` (which is unverified).
 *
 *   Custom claims live at the TOP LEVEL of the JWT (not in app_metadata):
 *     { user_kind: "client" | "staff" | "unprovisioned", org_id: "...", user_role: "..." }
 *
 *   When the hook is NOT yet activated (claims absent): user_kind is missing →
 *   treated as "unprovisioned" → no guard passes → safe degradation.
 *
 * NOTE: `readCustomClaims` in authz.ts was reading from user.app_metadata
 *   which only works in very specific Supabase JS versions. The authoritative
 *   source is the JWT payload returned by getClaims(). That function is used
 *   in middleware for performance; getActor() in authz.ts still uses getUser()
 *   for full server-side Actor construction (per-request, memoized).
 *   Both are consistent: getUser() also returns a user object whose JWT payload
 *   is accessible via user.app_metadata on the REMOTE side, but getClaims()
 *   reads directly from the cookie-stored JWT which is more efficient here.
 *
 * Boundary: middleware → platform/* only (DOC-21 §3 / eslint.config.mjs).
 * This file is at src/middleware.ts (required by Next.js; NOT src/app/middleware.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { logger } from "@/backend/platform/logger";
import type { Database } from "@/shared/database.types";

// ---------------------------------------------------------------------------
// Public routes — no session required
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = [
  "/welcome",
  "/no-access",
  "/email",           // client email entry (DOC-22 §1, replaces /phone June 2026)
  "/otp",
  "/login",           // staff login
  "/reset-password",  // staff password reset (email link lands here)
  "/offline",
  "/design",          // dev component showcase
];

const PUBLIC_PATH_PREFIXES = [
  "/firma/",          // contract signing (DOC-22 §4)
  "/api/webhooks/",   // webhook handlers (authed by signature, not cookie)
  "/_next/",          // Next.js static assets
  "/assets/",         // public static assets
  "/favicon",
  "/admin-preview",   // dev-only admin view harness (Playwright); 404s in prod
  "/cliente-preview", // dev-only client view harness (Playwright); 404s in prod
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Surface detection
// ---------------------------------------------------------------------------

function isClientSurface(pathname: string): boolean {
  // Routes under (cliente) group: /welcome, /email, /otp, /no-access, /home, etc.
  // Public paths (welcome, email, otp, no-access) are excluded above.
  const clientPaths = ["/home", "/servicios", "/comunidad", "/avisos", "/pagos", "/config", "/caso"];
  return clientPaths.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isStaffSurface(pathname: string): boolean {
  const staffPaths = ["/admin", "/ventas", "/legal", "/finanzas", "/cambiar-password"];
  return staffPaths.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// ---------------------------------------------------------------------------
// Custom claims extraction from JWT payload
// ---------------------------------------------------------------------------

interface CustomClaims {
  user_kind: "client" | "staff" | "unprovisioned";
  org_id: string | null;
  user_role: "admin" | "sales" | "paralegal" | "finance" | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCustomClaims(jwtClaims: Record<string, any> | null): CustomClaims {
  if (!jwtClaims) {
    return { user_kind: "unprovisioned", org_id: null, user_role: null };
  }

  const user_kind = (jwtClaims["user_kind"] as string) ?? "unprovisioned";
  const org_id = (jwtClaims["org_id"] as string) ?? null;
  const user_role = (jwtClaims["user_role"] as string | null) ?? null;

  return {
    user_kind: (["client", "staff", "unprovisioned"].includes(user_kind)
      ? user_kind
      : "unprovisioned") as CustomClaims["user_kind"],
    org_id,
    user_role: user_role as CustomClaims["user_role"],
  };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static assets early. The config.matcher already excludes known asset
  // extensions; no extra dot-check here (it would skip legit dotted routes).
  if (
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image")
  ) {
    return NextResponse.next();
  }

  // Build a mutable response to forward refreshed cookies
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Create SSR client — reads/writes cookies to refresh the session
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Step 1: Refresh session — getClaims() verifies the JWT via JWKS and
  // refreshes the access token if needed. This is the recommended pattern
  // for Next.js middleware (avoids a full Auth server round-trip on every request).
  //
  // Note: getClaims() may not be available on older @supabase/supabase-js versions.
  // If it throws or is undefined, fall back to getUser() for compatibility.
  let jwtClaims: Record<string, unknown> | null = null;
  let hasSession = false;
  let appMetadataFallback: Record<string, unknown> | null = null;

  try {
    // Try getClaims() first (validated JWT payload — faster than getUser())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimsResult = await (supabase.auth as any).getClaims?.();
    if (claimsResult && !claimsResult.error && claimsResult.data?.claims) {
      jwtClaims = claimsResult.data.claims;
      hasSession = true;
    } else {
      // getClaims() unavailable or no session — fall back to getUser()
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!error && user) {
        hasSession = true;
        // app_metadata is where Supabase JS exposes the JWT custom claims
        // from the hook via the user object returned by getUser()
        appMetadataFallback = (user.app_metadata as Record<string, unknown>) ?? null;
        // Also check top-level user fields (supabase-js may merge JWT claims there)
        // Use double cast via unknown to avoid TS index-signature error on the User type
        const userRecord = user as unknown as Record<string, unknown>;
        jwtClaims = {
          user_kind: userRecord["user_kind"] ?? appMetadataFallback?.["user_kind"],
          org_id: userRecord["org_id"] ?? appMetadataFallback?.["org_id"],
          user_role: userRecord["user_role"] ?? appMetadataFallback?.["user_role"],
        };
      }
    }
  } catch (err) {
    // Network error during session refresh — treat as no session (safe), but
    // leave a trace: a Supabase outage or misconfigured URL would otherwise
    // manifest as silent mass-redirects with nothing in the logs.
    logger.warn({ err }, "middleware: session refresh failed — treating as no session");
    hasSession = false;
  }

  // Step 2: If public path, skip guards but still return response with refreshed cookies
  if (isPublicPath(pathname)) {
    return response;
  }

  // Step 3: Root path — redirect to /welcome (client app entry point)
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    return NextResponse.redirect(url);
  }

  // Step 4: Extract custom claims
  const claims = extractCustomClaims(jwtClaims);

  // Step 5: Surface guards
  const onClientSurface = isClientSurface(pathname);
  const onStaffSurface = isStaffSurface(pathname);

  if (!hasSession || claims.user_kind === "unprovisioned") {
    // No valid session → redirect to the appropriate login
    if (onStaffSurface) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (onClientSurface) {
      const url = request.nextUrl.clone();
      url.pathname = "/welcome";
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (onClientSurface && claims.user_kind !== "client") {
    // Staff trying to access client surface → redirect to staff home
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.redirect(url);
  }

  if (onStaffSurface) {
    if (claims.user_kind !== "staff") {
      // Client trying to access staff surface → redirect to client home
      const url = request.nextUrl.clone();
      url.pathname = "/home";
      return NextResponse.redirect(url);
    }

    // Staff: check must_change_password (DOC-22 §2.2)
    // The hook injects `must_change_pw` as a TOP-LEVEL claim (read from
    // auth.users.raw_app_meta_data). The app_metadata fallback only covers the
    // getUser() path while the hook is not yet activated.
    const mustChangePassword =
      jwtClaims?.["must_change_pw"] === true ||
      appMetadataFallback?.["must_change_password"] === true;

    if (mustChangePassword && pathname !== "/cambiar-password") {
      const url = request.nextUrl.clone();
      url.pathname = "/cambiar-password";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Matcher — which routes middleware applies to
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - Files with extensions (images, fonts, etc.)
     *
     * This lets Next.js handle static assets directly without running
     * the middleware on every asset request.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|otf)).*)",
  ],
};
