// Applies migration 0023 to prod via the Supabase Management API.
// Usage: SBTOKEN=<token> node docs/_evidence/apply-0023.cjs
const fs = require("fs"), path = require("path");
const PROJ = "uexxyokexcamyjcknxua";
(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/0023_service_party_roles.sql"), "utf8");
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${t}`);
  console.log("APPLIED 0023 OK:", t || "(no rows)");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
