#!/usr/bin/env node
/**
 * Phone-as-identity backfill (2026-07 refactor).
 *
 * Standardizes every CLIENT auth.users row to the new identity model so their
 * login (signInWithPassword by phone) works and Auth stops holding the real
 * email as identity:
 *   - phone            = public.users.phone_e164   (the unique identity)
 *   - phone_confirm    = true
 *   - password         = derivePhonePassword(phone)  (deterministic HMAC)
 *   - email            = syntheticAuthEmail(phone)   ({digits}@clients.usalatinoprime.com)
 *   - email_confirm    = true                         (no verification mail; subdomain has no MX)
 * The REAL email stays untouched in public.users/client_profiles (optional,
 * repeatable contact data — never the identity again).
 *
 * Clients with NO phone are SKIPPED and reported (they can't log in under the
 * phone-identity model — a pre-refactor test/demo leftover).
 *
 * Idempotent: safe to run repeatedly. Dry-run by default; pass --apply to write.
 *
 * The two derivations below MUST match src/backend/modules/identity/domain.ts
 * (derivePhonePassword + syntheticAuthEmail). Kept in sync deliberately.
 *
 * Usage:
 *   node docs/_evidence/phone-identity/backfill-auth.cjs           # dry-run
 *   node docs/_evidence/phone-identity/backfill-auth.cjs --apply   # write to PROD auth
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const APPLY = process.argv.includes("--apply");
const SYNTHETIC_DOMAIN = "clients.usalatinoprime.com";

// --- load .env.local (gitignored) ------------------------------------------
function loadEnv() {
  const envPath = path.join(__dirname, "..", "..", "..", ".env.local");
  const raw = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
  return env;
}

// Mirror of identity/domain.ts derivePhonePassword + syntheticAuthEmail.
function derivePhonePassword(phoneE164, secret) {
  return crypto.createHmac("sha256", secret).update(phoneE164).digest("base64");
}
function syntheticAuthEmail(phoneE164) {
  return `${phoneE164.replace(/^\+/, "")}@${SYNTHETIC_DOMAIN}`;
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: clients, error } = await admin
    .from("users")
    .select("id, email, phone_e164, client_profiles(first_name, last_name)")
    .eq("kind", "client");
  if (error) throw new Error(`read clients: ${error.message}`);

  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — ${clients.length} client(s) found\n`);

  const skipped = [];
  let done = 0;

  for (const c of clients) {
    const profile = Array.isArray(c.client_profiles) ? c.client_profiles[0] : c.client_profiles;
    const name = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "(no name)";
    if (!c.phone_e164) {
      skipped.push({ id: c.id, name, email: c.email });
      console.log(`SKIP  ${name} — no phone (email ${c.email})`);
      continue;
    }
    const authEmail = syntheticAuthEmail(c.phone_e164);
    const password = derivePhonePassword(c.phone_e164, serviceKey);
    console.log(`FIX   ${name} — phone ${c.phone_e164} → auth email ${authEmail}`);
    if (APPLY) {
      const { error: upErr } = await admin.auth.admin.updateUserById(c.id, {
        email: authEmail,
        email_confirm: true,
        phone: c.phone_e164,
        phone_confirm: true,
        password,
      });
      if (upErr) {
        console.error(`  ✗ ${name}: ${upErr.message}`);
        continue;
      }
      done++;
    }
  }

  console.log(`\n${APPLY ? `Applied to ${done} client(s).` : "Dry-run only — pass --apply to write."}`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} phone-less client(s):`);
    for (const s of skipped) console.log(`  - ${s.name} (${s.email}) ${s.id}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
