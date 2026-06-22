/**
 * Applies supabase/migrations/0025_prospect_duration.sql to the remote project.
 * Usage: SBTOKEN=<token> node docs/_evidence/apply-0025.cjs
 */
const fs = require("fs");
const path = require("path");
const PROJ = "uexxyokexcamyjcknxua";
(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "..", "supabase", "migrations", "0025_prospect_duration.sql"),
    "utf8",
  );
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${t}`);
  process.stdout.write("OK 0025 applied: " + t + "\n");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
