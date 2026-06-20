/**
 * Applies migration 0022 (additive: form_questions.condition jsonb) to prod via
 * the Supabase Management API. Authorized by Henry. Non-destructive (ADD COLUMN
 * IF NOT EXISTS). Usage: SBTOKEN=<token> node docs/_evidence/apply-0022.cjs
 */
const PROJ = "uexxyokexcamyjcknxua";
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
};

(async () => {
  await q(
    "ALTER TABLE public.form_questions ADD COLUMN IF NOT EXISTS condition jsonb;" +
      " COMMENT ON COLUMN public.form_questions.condition IS " +
      "$c$Optional {when:{question,op,value}, action:show|lock|require, lock_message_i18n?}. NULL = unconditional. See src/shared/form-logic/conditions.ts.$c$;",
  );
  // Verify the column exists.
  const cols = await q(
    "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='form_questions' and column_name='condition';",
  );
  console.log("OK 0022 applied —", JSON.stringify(cols));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
