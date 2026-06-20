/**
 * Lists client users with a phone and whether they have an ACTIVATED case
 * (cases.opened_at IS NOT NULL) — i.e. eligible for the new phone-only login.
 * Uses the service-role key from .env.local (RLS bypass).
 */
const path = require("path");
const fs = require("fs");
const { createClient } = require(path.join(__dirname, "../../node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");

(async () => {
  const sb = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const { data: clients, error } = await sb
    .from("users")
    .select("id, email, phone_e164, is_active, kind")
    .eq("kind", "client");
  if (error) throw new Error(error.message);

  const rows = [];
  for (const c of clients) {
    const { data: members } = await sb
      .from("case_members")
      .select("case_id, cases!inner(opened_at, case_number, status)")
      .eq("user_id", c.id);
    const activated = (members ?? []).filter((m) => m.cases && m.cases.opened_at != null);
    rows.push({
      email: c.email,
      phone: c.phone_e164,
      is_active: c.is_active,
      cases: (members ?? []).length,
      activatedCases: activated.length,
      caseNumbers: activated.map((m) => m.cases.case_number),
      eligibleForPhoneLogin: !!(c.phone_e164 && c.is_active && activated.length > 0),
    });
  }
  process.stdout.write(JSON.stringify(rows, null, 2));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
