/**
 * Supabase client factory — DOC-22 §1.7, §3.3, DOC-27 §7.1.
 *
 * Two clients, two purposes:
 *
 * 1. `createServiceClient()` — service_role key, bypasses RLS entirely.
 *    USE ONLY in: webhooks, QStash jobs, identity bootstrap, revocation ops.
 *    NEVER use in request-scoped user data fetches (use createServerClient).
 *
 * 2. `createServerClient()` — anon key + SSR cookie adapter.
 *    The user's JWT is forwarded automatically; RLS applies as the user.
 *    Use in: route handlers, server actions, getActor().
 *
 * Both clients are typed with `Database` from the generated types (DOC-21).
 *
 * 3. `revokeAllSessions(userId, ban?)` — Admin API: invalidates all refresh
 *    tokens for a user.  If `ban=true`, also sets ban_duration='876600h' so
 *    no future login is possible until explicitly unblocked.
 */

import { createClient } from "@supabase/supabase-js";
import { createServerClient as createSSRClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/shared/database.types";
import { env } from "./env";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Service client (service_role — RLS bypass)
// ---------------------------------------------------------------------------

/**
 * Returns a Supabase client using the service_role key.
 *
 * This client bypasses ALL RLS policies. Reserve it for:
 * - Webhook handlers (Stripe, QStash, LiveKit, Resend)
 * - QStash job handlers
 * - Auth admin operations (revokeAllSessions, invite user)
 * - System-level bootstrapping (identity/service.ts: createUser)
 *
 * Do NOT export a singleton — create per request/job invocation to avoid
 * accidental state sharing across requests in serverless edge runtimes.
 */
export function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Server client (anon key + SSR cookies — RLS applies as the logged-in user)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// revokeAllSessions — DOC-22 §3.3
// ---------------------------------------------------------------------------

/**
 * Invalidates all refresh tokens for a user (global logout) via Admin API.
 *
 * If `ban=true`, also sets `ban_duration='876600h'` so the user cannot log in
 * again until `revokeAllSessions(userId, false)` is called with ban=false.
 *
 * DOC-22 §3.3: "revocación activa" pattern.
 * Note: a residual access token window (≤1 h) exists but is inert because
 * every request re-checks `users.is_active` via `getActor()`.
 */
export async function revokeAllSessions(
  userId: string,
  ban = false,
): Promise<void> {
  const client = createServiceClient();

  const { error: signOutError } =
    await client.auth.admin.signOut(userId, "global");

  if (signOutError) {
    logger.warn(
      { err: signOutError.message, userId },
      "revokeAllSessions: signOut error (non-fatal)",
    );
  }

  if (ban) {
    const { error: banError } = await client.auth.admin.updateUserById(userId, {
      ban_duration: "876600h", // ~100 years — effectively permanent until unblocked
    });

    if (banError) {
      logger.warn(
        { err: banError.message, userId },
        "revokeAllSessions: ban error (non-fatal)",
      );
    }
  } else {
    // Unban — called when reactivating a user
    const { error: unbanError } = await client.auth.admin.updateUserById(
      userId,
      {
        ban_duration: "none",
      },
    );

    if (unbanError) {
      logger.warn(
        { err: unbanError.message, userId },
        "revokeAllSessions: unban error (non-fatal)",
      );
    }
  }
}

/**
 * Returns a Supabase client bound to the current request cookies.
 *
 * The access token from the cookie is forwarded automatically; Postgres RLS
 * evaluates it as the logged-in user.
 *
 * Must be called in a Next.js server context (RSC, server action, route handler)
 * because it reads `cookies()` from next/headers.
 *
 * Always use `supabase.auth.getUser()` (validates against Auth server) when
 * you need identity — never rely solely on `getSession()` (DOC-22 §7).
 */
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSSRClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll may throw in RSC context (read-only cookies in layouts).
            // The middleware handles session refresh; this is safe to ignore.
          }
        },
      },
    },
  );
}
