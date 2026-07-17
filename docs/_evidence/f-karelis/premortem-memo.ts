/**
 * Karelis (ULP-2026-0024) — run the Pre-Mortem quality validator on the generated
 * Credible Fear Memorandum for REAL (Opus + web_search). Uses the enriched ai_letter
 * path: validates the memo against the SOURCE material (questionnaire answers +
 * declaración + evidencias) it was generated from, plus the seeded rubric.
 *
 * Reads the run id from docs/_evidence/premortem-memo/run-id.txt (written by
 * generate-memo.ts), or falls back to the latest completed memo run for the case.
 *
 * Usage: npx -y tsx docs/_evidence/f-karelis/premortem-memo.ts
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Defaults target Karelis; override via env for a smoke test on any completed run.
const CASE_ID = process.env.PREMORTEM_CASE_ID || "559220ae-796b-4110-ab45-bfc7eea6a564";
const RUN_ID_OVERRIDE = process.env.PREMORTEM_RUN_ID || "";
const HENRY_ADMIN = "00000000-0000-0000-0000-000000000001";
const RUN_ID_FILE = path.resolve(__dirname, "../premortem-memo/run-id.txt");
const OUT_FILE = path.resolve(__dirname, `../premortem-memo/assessment${RUN_ID_OVERRIDE ? "-smoke" : ""}.json`);

(async () => {
  const svc = await import("../../../src/backend/modules/ai-engine/service");
  const { createServiceClient } = await import("../../../src/backend/platform/supabase");
  const sb = createServiceClient();

  const { data: c } = await sb.from("cases").select("org_id").eq("id", CASE_ID).single();
  const orgId = (c as { org_id: string }).org_id;

  let runId: string | undefined = RUN_ID_OVERRIDE || undefined;
  if (!runId && fs.existsSync(RUN_ID_FILE)) runId = fs.readFileSync(RUN_ID_FILE, "utf8").trim() || undefined;
  if (runId) {
    const { data: r } = await sb.from("ai_generation_runs").select("status").eq("id", runId).single();
    if (!r || (r as { status: string }).status !== "completed") {
      console.log(`run ${runId} status=${(r as { status?: string })?.status ?? "missing"} — using latest eligible instead`);
      runId = undefined;
    }
  }

  const actor = { userId: HENRY_ADMIN, orgId, kind: "staff" as const, role: "admin" as const, permissions: new Map() };
  void actor;

  // Async refactor (2026-07-17): the validator now runs through the run-premortem
  // QStash job. For a LOCAL evidence run we insert the frozen queued row and drive
  // executePreMortemJob inline — same claim/complete lifecycle, no QStash needed.
  const repo = await import("../../../src/backend/modules/ai-engine/repository");
  if (!runId) {
    const { data: latest } = await sb
      .from("ai_generation_runs")
      .select("id")
      .eq("case_id", CASE_ID)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    runId = (latest as { id?: string } | null)?.id;
    if (!runId) throw new Error("no completed run found for the case");
  }
  const { data: runRow } = await sb
    .from("ai_generation_runs")
    .select("form_definition_id")
    .eq("id", runId)
    .single();

  console.log("executePreMortemJob (ai_letter)…", `runId=${runId}`);
  const inserted = await repo.insertPreMortemQueued({
    case_id: CASE_ID,
    target_kind: "ai_letter",
    run_id: runId,
    response_id: null,
    form_definition_id: (runRow as { form_definition_id: string | null })?.form_definition_id ?? null,
    status: "queued",
    created_by: HENRY_ADMIN,
  });
  if (inserted === "duplicate") throw new Error("a validation for this run is already queued/running");

  const outcome = await svc.executePreMortemJob({
    jobKey: "run-premortem",
    entityId: inserted.id,
    attempt: 1,
    dedupeId: `run-premortem:${inserted.id}`,
    orgId,
    assessmentId: inserted.id,
  });
  if (outcome !== "completed") throw new Error(`job outcome=${outcome}`);

  const rows = await svc.getPreMortemAssessmentsForCase(
    { userId: HENRY_ADMIN, orgId, kind: "staff", role: "admin", permissions: new Map() },
    CASE_ID,
  );
  const a = rows.find((r) => r.id === inserted.id);
  if (!a) throw new Error("assessment row not found after completion");

  const summary = {
    id: a.id, runId: a.runId, targetKind: a.targetKind,
    score: a.score, semaforo: a.semaforo, verdict: a.verdict,
    summary: a.summary, findingCount: a.findings.length,
    model: a.model, inputTokens: a.inputTokens, outputTokens: a.outputTokens, costUsd: a.costUsd,
    findings: a.findings,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2), "utf8");
  console.log("== PRE-MORTEM REPORT ==");
  console.log(`score=${a.score} semaforo=${a.semaforo} verdict=${a.verdict} findings=${a.findings.length} model=${a.model} cost=$${a.costUsd}`);
  console.log("summary:", a.summary);
  for (const f of a.findings.slice(0, 12)) console.log(`  [${f.severity}/${f.category}] ${f.location}: ${f.description}`);
  console.log("saved →", OUT_FILE);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
