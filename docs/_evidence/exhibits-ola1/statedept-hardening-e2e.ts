/**
 * statedept-hardening-e2e.ts — verifies the bot-block hardening LIVE.
 *
 * The State Dept site 403-blocks the renderer, which previously filed an
 * "experiencing technical difficulties / forbidden" error page as a real exhibit.
 * Now acquire() detects the error-page render and falls back to a Wayback snapshot
 * (method='archive'); if no good snapshot exists, the exhibit ends 'failed' (→ Diana
 * panel) rather than filing garbage. This seeds that one URL and checks the outcome.
 *
 * Run:  npx -y tsx docs/_evidence/exhibits-ola1/statedept-hardening-e2e.ts
 */
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(path.resolve(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const STATE_DEPT = "https://www.state.gov/reports/2023-country-reports-on-human-rights-practices/venezuela/";

async function main() {
  const { canonicalizeUrl, urlHash } = await import("../../../src/backend/platform/url-utils");
  const { executeFetchExhibitJob } = await import("../../../src/backend/modules/exhibits/service");
  const { extractPdfText, countPdfPages } = await import("../../../src/backend/platform/pdf");
  const { isErrorPageText } = await import("../../../src/backend/modules/exhibits/domain");

  const { data: run } = await supa.from("ai_generation_runs").select("id, case_id").limit(1).maybeSingle();
  if (!run) throw new Error("no run row");
  const canonical = canonicalizeUrl(STATE_DEPT);
  const hash = urlHash(canonical);
  const { data: ex, error } = await supa.from("case_exhibits").upsert(
    { case_id: run.case_id, run_id: run.id, source_kind: "country_condition", cite_order: 0, exhibit_label: "B-X", source_url: STATE_DEPT, canonical_url: canonical, url_hash: hash, title: "State Dept Venezuela 2023", publisher: "U.S. Department of State", status: "pending" },
    { onConflict: "run_id,url_hash" },
  ).select("id").single();
  if (error) throw new Error(`seed: ${error.message}`);
  log(`seeded State Dept exhibit ${ex.id}; fetching (expect render→error-page→Wayback)…`);

  const t0 = Date.now();
  const outcome = await executeFetchExhibitJob({ exhibitId: ex.id });
  log(`outcome=${outcome} (${Math.round((Date.now() - t0) / 1000)}s)`);

  const { data: row } = await supa.from("case_exhibits").select("status, fetch_method, final_url, page_count, pdf_path, last_error").eq("id", ex.id).single();
  let contentOk = "n/a";
  if (row?.status === "ready" && row.pdf_path) {
    const { data: blob } = await supa.storage.from("expedientes").download(row.pdf_path);
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    const text = await extractPdfText(bytes);
    const pages = await countPdfPages(bytes);
    contentOk = isErrorPageText(text, pages) ? "STILL ERROR PAGE ❌" : "real content ✅";
  }
  console.log("\n== RESULT ==");
  console.log(`status=${row?.status} method=${row?.fetch_method} pages=${row?.page_count}`);
  console.log(`final_url=${row?.final_url}`);
  console.log(`last_error=${row?.last_error ?? "—"}`);
  console.log(`content=${contentOk}`);
  // PASS = never a filed error page: a 'ready' exhibit must carry real content
  // (direct render OR Wayback), otherwise it must be 'failed' (→ Diana panel).
  const pass = row?.status === "failed" || (row?.status === "ready" && contentOk.includes("✅"));
  console.log(`\n==== ${pass ? "HARDENING PASS" : "HARDENING FAIL"} ====`);

  // cleanup
  if (row?.pdf_path) await supa.storage.from("expedientes").remove([row.pdf_path]);
  await supa.from("case_exhibits").delete().eq("id", ex.id);
  if (!pass) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
