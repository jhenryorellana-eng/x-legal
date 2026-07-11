/**
 * Seeds the Pre-Mortem filling guide (rubric) for the Credible Fear Memorandum
 * (form_definition `memorandum-de-miedo-creible`) into public.form_fill_guides.
 *
 * The canonical rubric lives in the repo at docs/guides/memorandum-miedo-creible-guia.md
 * (single source of truth, version-controlled). This script reads it and upserts it into
 * `guide_markdown`, keeping `enabled=true`. Idempotent (INSERT ... ON CONFLICT DO UPDATE).
 * The markdown is base64-encoded and decoded in SQL (convert_from(decode(...))) to avoid
 * any quote/dollar escaping issues with ~43 KB of content.
 *
 * Usage: SBTOKEN=<supabase-access-token> node docs/_evidence/seed-memo-guide.cjs
 */
const fs = require("fs");
const path = require("path");

const PROJ = "uexxyokexcamyjcknxua";
const FORM_DEF_ID = "b8ecfc63-323f-49e8-9e34-40679b9717a9"; // memorandum-de-miedo-creible
const GUIDE_REL_PATH = "docs/guides/memorandum-miedo-creible-guia.md";
const GUIDE_ABS_PATH = path.resolve(__dirname, "..", "guides", "memorandum-miedo-creible-guia.md");

async function runSql(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${t}`);
  return t;
}

(async () => {
  if (!process.env.SBTOKEN) throw new Error("Set SBTOKEN=<supabase access token>");
  const md = fs.readFileSync(GUIDE_ABS_PATH, "utf8");
  const b64 = Buffer.from(md, "utf8").toString("base64");

  const sql = `
    insert into public.form_fill_guides (form_definition_id, guide_markdown, source_file_path, enabled, updated_at)
    values (
      '${FORM_DEF_ID}',
      convert_from(decode('${b64}', 'base64'), 'utf8'),
      '${GUIDE_REL_PATH}',
      true,
      now()
    )
    on conflict (form_definition_id) do update set
      guide_markdown = excluded.guide_markdown,
      source_file_path = excluded.source_file_path,
      enabled = true,
      updated_at = now();
  `;
  await runSql(sql);

  const check = await runSql(
    `select form_definition_id, length(guide_markdown) as guide_len, enabled, source_file_path
     from public.form_fill_guides where form_definition_id = '${FORM_DEF_ID}';`,
  );
  process.stdout.write("Seeded. Row: " + check + "\n");
  console.error(`OK — guide chars: ${md.length}`);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
