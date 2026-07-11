/**
 * Karelis (ULP-2026-0024) — generate the Credible Fear Memorandum for REAL (Opus),
 * driving the sectioned engine job loop directly (bypasses QStash public delivery).
 *
 * startGeneration freezes the config_snapshot (system prompt + 17 sections +
 * resolved_inputs = questionnaire answers + declaración + evidencias), then we call
 * executeGenerationJob in a loop: the engine checkpoints `progress` and self-chains,
 * so each call resumes from the last section until status = completed.
 *
 * Self-dispatch inside enqueueJob targets http://localhost:3000 (NEXT_PUBLIC_APP_URL)
 * which is empty here, so it fails harmlessly — this loop is the sole executor.
 *
 * Usage: npx -y tsx docs/_evidence/f-karelis/generate-memo.ts
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CASE_ID = "559220ae-796b-4110-ab45-bfc7eea6a564";
const FORM_ID = "b8ecfc63-323f-49e8-9e34-40679b9717a9"; // memorandum-de-miedo-creible
const HENRY_ADMIN = "00000000-0000-0000-0000-000000000001";
const RUN_ID_FILE = path.resolve(__dirname, "../premortem-memo/run-id.txt");

const ts = () => new Date().toISOString().slice(11, 19);

(async () => {
  const svc = await import("../../../src/backend/modules/ai-engine/service");
  const { createServiceClient } = await import("../../../src/backend/platform/supabase");
  const sb = createServiceClient();

  const { data: c, error } = await sb.from("cases").select("org_id").eq("id", CASE_ID).single();
  if (error || !c) throw new Error("case not found: " + (error?.message ?? ""));
  const orgId = c.org_id as string;

  const actor = { userId: HENRY_ADMIN, orgId, kind: "staff" as const, role: "admin" as const, permissions: new Map() };

  console.log(`[${ts()}] startGeneration…`);
  const started = await svc.startGeneration(actor, { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null });
  const run = (started as { run: { id: string; version: number; status: string } }).run;
  fs.writeFileSync(RUN_ID_FILE, run.id, "utf8");
  console.log(`[${ts()}] run ${run.id} v${run.version} status=${run.status}`);

  const dedupeId = `run-generation:${run.id}:v${run.version}`;
  let iter = 0;
  let stagnant = 0;
  let prevProgress = "";
  while (iter < 80) {
    iter++;
    let outcome = "?";
    try {
      outcome = await svc.executeGenerationJob({ jobKey: "run-generation", runId: run.id, entityId: run.id, attempt: 1, dedupeId, orgId });
    } catch (e) {
      console.log(`[${ts()}] iter ${iter}: job threw: ${(e as Error).message}`);
    }
    const { data: r } = await sb.from("ai_generation_runs").select("status, progress, output_text, error").eq("id", run.id).single();
    const prog = JSON.stringify(r?.progress ?? {});
    const done = r?.progress && typeof r.progress === "object" ? (r.progress as Record<string, unknown>).sectionsDone ?? (r.progress as Record<string, unknown>).completedSections : undefined;
    const outLen = (r?.output_text as string | null)?.length ?? 0;
    console.log(`[${ts()}] iter ${iter}: outcome=${outcome} status=${r?.status} progress=${done ?? "?"} outLen=${outLen}`);
    if (r?.status === "completed") { console.log(`[${ts()}] ✅ COMPLETED`); break; }
    if (r?.status === "failed" || r?.status === "cancelled") { console.log(`[${ts()}] ⛔ ${r.status}: ${r?.error ?? ""}`); break; }
    stagnant = prog === prevProgress ? stagnant + 1 : 0;
    prevProgress = prog;
    if (stagnant >= 6) { console.log(`[${ts()}] ⚠ no progress for 6 iters — bailing (status=${r?.status})`); break; }
  }

  const { data: fin } = await sb
    .from("ai_generation_runs")
    .select("status, output_path, model, input_tokens, output_tokens, cost_usd")
    .eq("id", run.id)
    .single();
  console.log(`[${ts()}] FINAL run=${run.id}`, fin);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
