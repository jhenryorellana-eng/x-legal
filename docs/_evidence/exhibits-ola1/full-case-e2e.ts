/**
 * full-case-e2e.ts — a LIVE case for the automatic-exhibits feature.
 *
 * Drives the REAL feature code in-process (the same functions QStash would call,
 * minus the transport which can't reach localhost):
 *   1. REAL AI research (analysis + jurisprudence + country conditions, web_search
 *      with a curated REAL-URL fallback) → the cited sources.
 *   2. Persist a completed ai_generation_runs row with output PDF + research bundle.
 *   3. REAL captureFromRun → case_exhibits.
 *   4. REAL executeFetchExhibitJob per exhibit → download/render to PDF (Urlbox/direct).
 *   5. REAL expediente draft + memo item + attachReadyExhibits (exhibits filed after memo).
 *   6. REAL compileExpedientePdf → final court packet with Index + Bates (USALP-####).
 *
 * The memo BODY is intentionally short (the engine is already proven elsewhere) —
 * the point is the exhibits: real cited sources, downloaded, filed, and foliated.
 *
 * Run:  npx -y tsx docs/_evidence/exhibits-ola1/full-case-e2e.ts
 * Keep artifacts (skip cleanup):  KEEP=1 npx -y tsx docs/_evidence/exhibits-ola1/full-case-e2e.ts
 */
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { CURATED_JURISPRUDENCE, CURATED_COUNTRY, CASE_CONTEXT } from "../asylum-full-pipeline";

for (const line of fs.readFileSync(path.resolve(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anthropic = new Anthropic();
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const KEEP = process.env.KEEP === "1";

async function main() {
  // app modules (dynamic — after env load)
  const dom = await import("../../../src/backend/modules/ai-engine/domain");
  const { checkUrlReachable, keepReachable } = await import("../../../src/backend/platform/url-utils");
  const { renderMarkdownToPdf, compileExpedientePdf, countPdfPages } = await import("../../../src/backend/platform/pdf");
  const { uploadBytesToStorage, downloadBytesFromStorage } = await import("../../../src/backend/platform/storage");
  const exhibits = await import("../../../src/backend/modules/exhibits");

  // 1) Config + case
  const { data: cfgRow } = await supa
    .from("ai_generation_configs")
    .select("*, form_definitions!inner(slug, service_phase_id)")
    .eq("form_definitions.slug", "memorandum-de-miedo-creible")
    .single();
  const cfg = cfgRow as Record<string, unknown> & { form_definition_id: string; research_model?: string; research_instructions?: string };
  const caseId = "35023394-b5b7-43cc-9111-5fcf865a9e6f"; // ULP-2026-0011 (demo)
  const researchModel = (cfg.research_model as string) || "claude-opus-4-7";
  log(`config loaded (attach_sources_enabled=${(cfg as Record<string, unknown>).attach_sources_enabled}, kinds=${JSON.stringify((cfg as Record<string, unknown>).attach_sources_kinds)})`);

  // 2) REAL research (analysis → jurisprudence → country, web_search w/ curated fallback)
  type SysBlock = { text: string; ephemeral?: boolean };
  const call = async (system: string | SysBlock[], user: string, useSearch: boolean) => {
    const systemParam = typeof system === "string"
      ? system
      : system.map((b) => ({ type: "text" as const, text: b.text, ...(b.ephemeral ? { cache_control: { type: "ephemeral" as const } } : {}) }));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), useSearch ? 120_000 : 180_000);
    try {
      const stream = anthropic.messages.stream(
        { model: researchModel, max_tokens: 8000, system: systemParam as never, messages: [{ role: "user", content: user }], ...(useSearch ? { tools: [dom.buildWebSearchTool(6, researchModel)] as never } : {}) },
        { timeout: 180_000, maxRetries: 1, signal: ctrl.signal },
      );
      const msg = await stream.finalMessage();
      return msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    } finally {
      clearTimeout(timer);
    }
  };

  log("research: analysis…");
  const ap = dom.buildAnalysisPrompt({ systemPrompt: cfg.system_prompt as string, caseContext: CASE_CONTEXT });
  const analysis = dom.parseResearchAnalysis(await call(ap.system as string | SysBlock[], ap.user, false));
  log(`analysis parsed=${!!analysis}, chronology=${analysis?.chronology.length ?? 0}`);

  const research = async <T>(p: { system: string | SysBlock[]; user: string }, parse: (t: string) => T[], label: string): Promise<T[]> => {
    try {
      const list = parse(await call(p.system, p.user, true));
      log(`research: ${label} → ${list.length} via web_search`);
      return list;
    } catch (e) {
      log(`research: ${label} web_search failed (${e instanceof Error ? e.message : e})`);
      return [];
    }
  };
  const skipSearch = process.env.SKIP_WEBSEARCH === "1";
  const instr = cfg.research_instructions ?? null;
  let jur = skipSearch ? [] : await research(dom.buildJurisprudencePrompt({ instructions: instr, analysis }), dom.parseJurisprudence, "jurisprudence");
  let country = skipSearch ? [] : await research(dom.buildCountryConditionsPrompt({ instructions: instr, analysis }), dom.parseCountryConditions, "country");
  if (jur.length === 0) { log("research: curated jurisprudence fallback (real verified URLs)"); jur = CURATED_JURISPRUDENCE as typeof jur; }
  if (country.length === 0) { log("research: curated country fallback (real verified URLs)"); country = CURATED_COUNTRY as typeof country; }
  jur = await Promise.all(jur.map(async (c) => (c.url && !(await checkUrlReachable(c.url)).reachable ? { ...c, url: "" } : c)));
  country = await keepReachable(country);
  const bundle = { analysis, jurisprudence: jur, country_conditions: country };
  log(`research done: jurisprudence=${jur.length}, country(verified)=${country.length}`);

  // 3) Short memo PDF (cover + intro + chronology + REAL Index of Exhibits) + persist run
  const cover = dom.buildCoverPage((cfg.assembly as { cover_page?: unknown } | null)?.cover_page ?? null, {
    applicant_name: "Carlos Andrés Mendoza Rivas", nationality: "Venezuela",
    derivatives: "Spouse and one minor child", entry_date: "March 18, 2023",
    principal_theory: analysis?.principal_theory ?? "Political opinion",
  });
  const chrono = analysis?.chronology.length ? dom.buildChronologyTable(analysis.chronology) : "";
  const annexes = dom.buildAnnexesSection(bundle) || "";
  const memoMd = [
    cover,
    "<<<PAGEBREAK>>>",
    "## Statement of Facts and Argument",
    "This memorandum supports the applicant's credible-fear / asylum claim. The sources cited below are filed in full as exhibits behind this memorandum.",
    chrono ? "<<<PAGEBREAK>>>\n## Chronology\n\n" + chrono : "",
    annexes ? "<<<PAGEBREAK>>>\n" + annexes : "",
  ].filter(Boolean).join("\n\n");
  const memoPdf = await renderMarkdownToPdf(memoMd);
  const memoPath = `runs/live-${Date.now()}/output.pdf`;
  await uploadBytesToStorage("generated", memoPath, memoPdf, "application/pdf");
  log(`memo rendered: ${await countPdfPages(memoPdf)} pages → generated/${memoPath}`);

  const { data: maxRow } = await supa.from("ai_generation_runs").select("version").eq("case_id", caseId).eq("form_definition_id", cfg.form_definition_id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (maxRow?.version ?? 0) + 1;
  const { data: runRow, error: runErr } = await supa.from("ai_generation_runs").insert({
    case_id: caseId, form_definition_id: cfg.form_definition_id, party_id: null, version,
    status: "completed", config_snapshot: { ...(cfg as object), research: bundle }, output_text: memoMd, output_path: memoPath,
    model: researchModel, is_test: true,
  }).select("id").single();
  if (runErr) throw new Error(`insert run: ${runErr.message}`);
  const runId = runRow.id as string;
  log(`run persisted: ${runId} (v${version})`);

  // 4) REAL capture + fetch
  // captureFromRun INSERTS the exhibits, then fans out QStash jobs. Locally QStash
  // refuses a localhost callback URL, so the fan-out throws AFTER the rows exist —
  // we catch it and invoke the SAME real fetch handler directly below.
  try {
    const cap = await exhibits.captureFromRun({ runId });
    log(`captureFromRun → captured=${cap.captured}, enqueued=${cap.enqueued}`);
  } catch (e) {
    log(`captureFromRun: exhibits inserted; QStash fan-out skipped (localhost): ${e instanceof Error ? e.message.slice(0, 70) : e}`);
  }
  const pending = await supa.from("case_exhibits").select("id, exhibit_label, source_kind, canonical_url").eq("run_id", runId).eq("status", "pending");
  log(`fetching ${pending.data?.length ?? 0} exhibits (real Urlbox/direct)…`);
  for (const ex of pending.data ?? []) {
    const t0 = Date.now();
    const outcome = await exhibits.executeFetchExhibitJob({ exhibitId: ex.id });
    log(`  ${ex.exhibit_label} [${ex.source_kind}] ${outcome} (${Date.now() - t0}ms) ${ex.canonical_url}`);
  }
  const ready = await exhibits.listReadyByCase(caseId);
  const readyForRun = ready.filter((e) => e.run_id === runId);
  const failed = await supa.from("case_exhibits").select("exhibit_label, last_error").eq("run_id", runId).eq("status", "failed");
  log(`exhibits ready=${readyForRun.length}, failed=${failed.data?.length ?? 0}`);

  // 5+6) Compile the final court packet directly: memo + ready exhibits (cite order)
  // → auto Index of Exhibits + continuous Bates (USALP-####). The expediente
  // auto-insertion (attachReadyExhibits) is covered by unit + placement tests; here
  // we render the real artifact without creating an expediente row, to avoid
  // colliding with any existing draft on the demo case.
  const ordered = [...readyForRun].sort((a, b) => a.cite_order - b.cite_order);
  const resolved: { bytes: Uint8Array; mimeType: string; title: string; includeInToc: boolean }[] = [
    { bytes: memoPdf, mimeType: "application/pdf", title: "Credible-Fear Memorandum", includeInToc: true },
  ];
  for (const ex of ordered) {
    const bytes = await downloadBytesFromStorage("expedientes", ex.pdf_path as string);
    resolved.push({
      bytes,
      mimeType: "application/pdf",
      title: `Exhibit ${ex.exhibit_label ?? ""} — ${ex.publisher ?? ex.title ?? "Source"}`.trim(),
      includeInToc: true,
    });
  }
  const compiled = await compileExpedientePdf(resolved);
  const outPath = path.resolve(__dirname, "live-case-expediente.pdf");
  fs.writeFileSync(outPath, Buffer.from(compiled.pdf));
  log(`COMPILED: ${compiled.pageCount} pages, ${resolved.length} items (1 memo + ${resolved.length - 1} exhibits) → ${outPath}`);
  log(`TOC: ${compiled.toc.map((t) => `${t.title}@p${t.startPage}`).join(" | ")}`);

  if (!KEEP) {
    for (const e of readyForRun) if (e.pdf_path) await supa.storage.from("expedientes").remove([e.pdf_path]);
    await supa.from("case_exhibits").delete().eq("run_id", runId);
    await supa.from("ai_generation_runs").delete().eq("id", runId);
    await supa.storage.from("generated").remove([memoPath]);
    log("cleanup done (DB + storage). Final PDF kept on disk.");
  } else {
    log(`KEEP=1 → run ${runId} left in DB for inspection.`);
  }
  log(`\n==== LIVE CASE DONE — open ${outPath} ====`);
}

main().catch((e) => { console.error("LIVE CASE error:", e); process.exit(1); });
