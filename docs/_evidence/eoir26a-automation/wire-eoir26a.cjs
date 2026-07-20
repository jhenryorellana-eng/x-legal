/* Wire the published EOIR-26A into the rest of the flow:
 *  1. Upload the fill guide to form_fill_guides (Pre-Mortem rubric), enabled.
 *  2. Brief config: add 'eoir-26a' to input_form_slugs + refresh the system_prompt
 *     (conditional fee-waiver sentence) on the escrito-de-apelacion ai_generation_config.
 * Idempotent. node docs/_evidence/eoir26a-automation/wire-eoir26a.cjs [--apply]
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));
const APPLY = process.argv.includes("--apply");
const ROOT = path.join(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const die = (s, e) => { console.error(`FAIL [${s}]:`, e?.message ?? e); process.exit(1); };

(async () => {
  // Resolve the two form_definitions by slug.
  const { data: defs } = await db.from("form_definitions").select("id, slug").in("slug", ["eoir-26a", "escrito-de-apelacion"]);
  const eoir26a = defs?.find((d) => d.slug === "eoir-26a");
  const brief = defs?.find((d) => d.slug === "escrito-de-apelacion");
  if (!eoir26a) die("resolve", "eoir-26a not found (publish it first)");
  if (!brief) die("resolve", "escrito-de-apelacion not found");

  const guideMd = fs.readFileSync(path.join(ROOT, "docs/guides/eoir-26a-fee-waiver-guia.md"), "utf8");
  const systemPrompt = fs.readFileSync(path.join(ROOT, "docs/_evidence/apelacion-brief/drafts/system-prompt.txt"), "utf8").trim();

  // Read current brief config.
  const { data: cfg } = await db.from("ai_generation_configs").select("input_form_slugs, system_prompt").eq("form_definition_id", brief.id).maybeSingle();
  const slugs = Array.from(new Set([...(cfg?.input_form_slugs ?? []), "eoir-26a"]));

  console.log(`eoir-26a=${eoir26a.id}  brief=${brief.id}`);
  console.log(`guide: ${guideMd.length} chars → form_fill_guides (enabled)`);
  console.log(`brief input_form_slugs → [${slugs.join(", ")}]`);
  console.log(`brief system_prompt: ${systemPrompt.length} chars (fee-waiver conditional ${systemPrompt.includes("EOIR-26A") ? "PRESENT" : "MISSING"})`);
  if (!APPLY) { console.log("\n(dry-run — usa --apply)"); return; }

  // 1. form_fill_guides upsert.
  const g = await db.from("form_fill_guides").upsert(
    { form_definition_id: eoir26a.id, guide_markdown: guideMd, enabled: true, source_file_path: "docs/guides/eoir-26a-fee-waiver-guia.md" },
    { onConflict: "form_definition_id" },
  );
  if (g.error) die("form_fill_guides", g.error);
  console.log("OK — guía Pre-Mortem cargada (enabled).");

  // 2. brief config update.
  const u = await db.from("ai_generation_configs").update({ input_form_slugs: slugs, system_prompt: systemPrompt }).eq("form_definition_id", brief.id);
  if (u.error) die("ai_generation_configs", u.error);
  console.log("OK — brief cableado (input_form_slugs + system_prompt).");
  console.log("DONE");
})();
