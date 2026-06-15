/**
 * E2E DB helper — service_role Supabase client for assertions only.
 *
 * The canonical E2E specs assert on backend state (DOC-81 §4: "aserciones de UI
 * Y de BD vía cliente service_role del harness"). This returns a client that
 * bypasses RLS so a spec can read `case_form_responses.status`,
 * `ai_generation_runs.version/cost_usd`, `filled_pdf_path`, etc.
 *
 * NEVER used to seed production data — reads/asserts only. Env is loaded from
 * `.env.local` by `playwright.config.ts` (via @next/env) into process.env.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/** Returns a memoised service_role client for BD assertions in E2E specs. */
export function serviceDb(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[e2e/db] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "playwright.config.ts loads .env.local — ensure both are set.",
    );
  }

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}
