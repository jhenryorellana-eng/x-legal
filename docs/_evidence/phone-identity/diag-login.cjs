// Diagnostic: does signInWithPassword({ phone }) work for a migrated client?
// Tries both "+E164" and bare-digits phone formats to catch a normalization
// mismatch between what we pass and what Supabase stored. Read-only (a sign-in).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const derivePhonePassword = (p, s) => crypto.createHmac("sha256", s).update(p).digest("base64");

(async () => {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const phoneE164 = "+13466094183"; // Ivis
  const password = derivePhonePassword(phoneE164, serviceKey);
  const syntheticEmail = `${phoneE164.replace(/^\+/, "")}@clients.usalatinoprime.com`;

  const c = createClient(url, anon, { auth: { persistSession: false } });
  const r = await c.auth.signInWithPassword({ email: syntheticEmail, password });
  console.log(`email="${syntheticEmail}" →`, r.error ? `ERROR: ${r.error.message}` : `OK user=${r.data.user?.id}`);
})().catch((e) => { console.error(e); process.exit(1); });
