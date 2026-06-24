/**
 * Seed the ORG-level availability for scheduling (DOC-43 org agenda).
 *
 * Replaces the org's availability_rules with a Mon–Fri 09:00–12:00 + 14:00–17:00
 * schedule in America/New_York (the office TZ). Org-level: staff_id is null — the
 * agenda belongs to the org, not a person (migration 0027). Idempotent.
 *
 * Run: node docs/_evidence/seed-org-availability.cjs
 */
const fs = require("fs");
const path = require("path");

const envText = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { createClient } = require("@supabase/supabase-js");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const TIMEZONE = "America/New_York";
const BLOCKS = [
  ["09:00:00", "12:00:00"],
  ["14:00:00", "17:00:00"],
];
const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri (0=Sunday)

async function main() {
  // Resolve the (single) org.
  const { data: orgs, error: orgErr } = await sb.from("orgs").select("id").order("created_at").limit(1);
  if (orgErr) throw orgErr;
  const orgId = orgs?.[0]?.id;
  if (!orgId) throw new Error("No org found");

  // Replace org rules (delete + insert) — mirrors scheduling.replaceRules.
  const { error: delErr } = await sb.from("availability_rules").delete().eq("org_id", orgId);
  if (delErr) throw delErr;

  const rows = [];
  for (const weekday of WEEKDAYS) {
    for (const [start, end] of BLOCKS) {
      rows.push({
        org_id: orgId,
        staff_id: null,
        weekday,
        start_local: start,
        end_local: end,
        timezone: TIMEZONE,
        is_active: true,
      });
    }
  }
  const { error: insErr } = await sb.from("availability_rules").insert(rows);
  if (insErr) throw insErr;

  const { data: check } = await sb
    .from("availability_rules")
    .select("weekday, start_local, end_local, timezone")
    .eq("org_id", orgId)
    .order("weekday")
    .order("start_local");

  console.log(`Seeded ${rows.length} org availability rules for org ${orgId}:`);
  for (const r of check || []) {
    console.log(`  weekday ${r.weekday}: ${r.start_local}–${r.end_local} ${r.timezone}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
