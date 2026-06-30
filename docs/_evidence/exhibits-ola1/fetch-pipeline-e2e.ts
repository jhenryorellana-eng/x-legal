/**
 * fetch-pipeline-e2e.ts — LIVE end-to-end test of the exhibit fetch pipeline.
 *
 * Seeds two real exhibits (an HTML country-conditions page + a direct PDF) against
 * a real case+run, runs the REAL executeFetchExhibitJob (claim → acquire → Urlbox
 * render / direct download → store in the `expedientes` bucket → markReady), and
 * verifies the DB state + the stored PDF bytes. Cleans up after itself.
 *
 * Run:  npx -y tsx docs/_evidence/exhibits-ola1/fetch-pipeline-e2e.ts
 */
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// ── env FIRST (before any app import — app modules parse env eagerly) ──────────
for (const line of fs.readFileSync(path.resolve(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const SOURCES = [
  { kind: "country_condition", label: "B-1", url: "https://www.hrw.org/world-report/2024/country-chapters/venezuela", title: "HRW World Report 2024 — Venezuela", publisher: "Human Rights Watch", expectMethod: "render" },
  { kind: "jurisprudence", label: "A-1", url: "https://www.uscis.gov/sites/default/files/document/forms/i-589.pdf", title: "USCIS I-589 (direct PDF sample)", publisher: "USCIS", expectMethod: "pdf" },
];

async function main() {
  const { canonicalizeUrl, urlHash } = await import("../../../src/backend/platform/url-utils");
  const { executeFetchExhibitJob } = await import("../../../src/backend/modules/exhibits/service");

  // 1. Pick a real case + run (FKs).
  const { data: run } = await supa.from("ai_generation_runs").select("id, case_id").limit(1).maybeSingle();
  if (!run) throw new Error("no ai_generation_runs row to attach exhibits to");
  console.log(`case=${run.case_id} run=${run.id}`);

  // 2. Seed exhibits (status pending).
  const seeded: Array<{ id: string; urlHash: string; caseId: string; expectMethod: string }> = [];
  for (let i = 0; i < SOURCES.length; i++) {
    const s = SOURCES[i];
    const canonical = canonicalizeUrl(s.url);
    const hash = urlHash(canonical);
    const { data, error } = await supa
      .from("case_exhibits")
      .upsert(
        {
          case_id: run.case_id, run_id: run.id, source_kind: s.kind, cite_order: i,
          exhibit_label: s.label, source_url: s.url, canonical_url: canonical, url_hash: hash,
          title: s.title, publisher: s.publisher, status: "pending",
        },
        { onConflict: "run_id,url_hash" },
      )
      .select("id")
      .single();
    if (error) throw new Error(`seed ${s.label}: ${error.message}`);
    seeded.push({ id: data.id, urlHash: hash, caseId: run.case_id, expectMethod: s.expectMethod });
    console.log(`seeded ${s.label} → exhibit ${data.id}`);
  }

  // 3. Run the REAL fetch job for each exhibit.
  console.log("\n== running executeFetchExhibitJob (real Urlbox + storage) ==");
  for (const ex of seeded) {
    const t0 = Date.now();
    const outcome = await executeFetchExhibitJob({ exhibitId: ex.id });
    console.log(`  exhibit ${ex.id}: outcome=${outcome} (${Date.now() - t0}ms)`);
  }

  // 4. Verify DB state + stored bytes.
  console.log("\n== verification ==");
  let allOk = true;
  for (const ex of seeded) {
    const { data: row } = await supa
      .from("case_exhibits")
      .select("status, fetch_method, pdf_path, page_count, content_sha256")
      .eq("id", ex.id)
      .single();
    let bytesOk = false;
    let size = 0;
    if (row?.pdf_path) {
      const { data: blob } = await supa.storage.from("expedientes").download(row.pdf_path);
      if (blob) {
        const buf = Buffer.from(await blob.arrayBuffer());
        size = buf.length;
        bytesOk = buf.subarray(0, 4).toString("latin1") === "%PDF";
      }
    }
    const ok =
      row?.status === "ready" && !!row.pdf_path && (row.page_count ?? 0) >= 1 &&
      row.fetch_method === ex.expectMethod && bytesOk;
    allOk = allOk && ok;
    console.log(
      `  [${ok ? "OK" : "FAIL"}] ${ex.id}: status=${row?.status} method=${row?.fetch_method} ` +
        `pages=${row?.page_count} storedPDF=${bytesOk}(${size}B) path=${row?.pdf_path}`,
    );
  }

  // 5. Cleanup (rows + storage objects).
  for (const ex of seeded) {
    const { data: row } = await supa.from("case_exhibits").select("pdf_path").eq("id", ex.id).single();
    if (row?.pdf_path) await supa.storage.from("expedientes").remove([row.pdf_path]);
    await supa.from("case_exhibits").delete().eq("id", ex.id);
  }
  console.log("\ncleanup done.");
  console.log(`\n==== ${allOk ? "E2E PASS" : "E2E FAIL"} ====`);
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error("E2E error:", e);
  process.exit(1);
});
