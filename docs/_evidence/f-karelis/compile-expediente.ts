/**
 * Karelis (ULP-2026-0024) — compile a NEW expediente attempt containing the
 * Form I-589 + the Credible Fear Memorandum (single-phase Asilo).
 *
 * The existing attempt #1 is `printed` and predates the memo, so it doesn't include
 * it. This creates a fresh draft (attempt #2), adds the I-589 (automated_form) and
 * the memo (ai_generation) as items, and compiles to a Bates/TOC PDF — all via the
 * service-role manual route (no AI covers / getCaseWorkspace → no cookies).
 * Assembly is by case_id only, so the 2-phases→1 unification is irrelevant here.
 *
 * Usage: npx -y tsx docs/_evidence/f-karelis/compile-expediente.ts
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CASE_ID = "559220ae-796b-4110-ab45-bfc7eea6a564";
const I589_RESPONSE_ID = "8ba801ac-8897-406c-a159-63743861fef9";
const MEMO_RUN_ID = "d37890d9-a3de-43ce-bdf4-6e07aac69230";
const HENRY_ADMIN = "00000000-0000-0000-0000-000000000001";

(async () => {
  const cases = await import("../../../src/backend/modules/cases");
  const exp = await import("../../../src/backend/modules/expediente");
  const { createServiceClient } = await import("../../../src/backend/platform/supabase");
  const sb = createServiceClient();

  const { data: c } = await sb.from("cases").select("org_id").eq("id", CASE_ID).single();
  const actor = { userId: HENRY_ADMIN, orgId: (c as { org_id: string }).org_id, kind: "staff" as const, role: "admin" as const, permissions: new Map() };

  // (a) Ensure the I-589 filled PDF exists (idempotent — regenerates if needed).
  const { data: fr } = await sb.from("case_form_responses").select("filled_pdf_path").eq("id", I589_RESPONSE_ID).single();
  if (!(fr as { filled_pdf_path: string | null })?.filled_pdf_path) {
    console.log("I-589 PDF missing → generating…");
    await (cases as { generateFilledPdf: (a: unknown, i: { responseId: string }) => Promise<string> }).generateFilledPdf(actor, { responseId: I589_RESPONSE_ID });
  } else {
    console.log("I-589 PDF present ✓");
  }

  // (b) Get/create a draft expediente (existing attempt #1 is printed → new attempt).
  const rows = await (exp as { getCaseExpedientes: (a: unknown, id: string) => Promise<Array<{ id: string; status: string; attempt_no: number }>> }).getCaseExpedientes(actor, CASE_ID);
  let draft = rows.find((r) => r.status === "draft" || r.status === "corrections_needed");
  if (!draft) {
    draft = await (exp as { createExpediente: (a: unknown, i: { caseId: string }) => Promise<{ id: string; status: string; attempt_no: number }> }).createExpediente(actor, { caseId: CASE_ID });
    console.log(`created draft ${draft.id} (attempt ${draft.attempt_no})`);
  } else {
    console.log(`reusing draft ${draft.id} (attempt ${draft.attempt_no})`);
  }

  // (c) Add items (I-589 first, then memo) — guard against duplicates on re-run.
  const { data: existing } = await sb.from("expediente_items").select("item_type, ref_id").eq("expediente_id", draft.id);
  const has = (t: string, r: string) => (existing ?? []).some((e: { item_type: string; ref_id: string | null }) => e.item_type === t && e.ref_id === r);
  const addItem = (exp as unknown as { addItem: (a: unknown, i: Record<string, unknown>) => Promise<{ id: string }> }).addItem;

  if (!has("automated_form", I589_RESPONSE_ID)) {
    await addItem(actor, { expedienteId: draft.id, itemType: "automated_form", refId: I589_RESPONSE_ID, title: "Form I-589 — Application for Asylum", includeInToc: true });
    console.log("added I-589");
  }
  if (!has("ai_generation", MEMO_RUN_ID)) {
    await addItem(actor, { expedienteId: draft.id, itemType: "ai_generation", refId: MEMO_RUN_ID, title: "Credible Fear Memorandum", includeInToc: true });
    console.log("added Memorándum");
  }

  // (d) Compile to PDF (synchronous).
  console.log("compiling…");
  const result = await (exp as { compileExpediente: (a: unknown, id: string) => Promise<{ compiledPdfPath: string; pageCount: number }> }).compileExpediente(actor, draft.id);
  console.log("== COMPILED ==");
  console.log(JSON.stringify({ expedienteId: draft.id, attempt: draft.attempt_no, ...result }, null, 2));

  // final state + items
  const { data: fin } = await sb.from("expedientes").select("status, page_count, compiled_pdf_path").eq("id", draft.id).single();
  const { data: items } = await sb.from("expediente_items").select("position, item_type, title").eq("expediente_id", draft.id).order("position");
  console.log("final:", fin);
  console.log("items:", items);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
