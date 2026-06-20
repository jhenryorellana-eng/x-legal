/**
 * Generic Supabase Management API SQL runner.
 * Usage: SBTOKEN=<token> node docs/_evidence/q.cjs "select ..."
 * Prints JSON rows to stdout.
 */
const PROJ = "uexxyokexcamyjcknxua";
(async () => {
  const sql = process.argv[2];
  if (!sql) throw new Error("usage: node q.cjs \"<sql>\"");
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${t}`);
  process.stdout.write(t);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
