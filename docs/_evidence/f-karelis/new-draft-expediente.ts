/**
 * Karelis — create a fresh DRAFT expediente (new attempt) so the "Auto-ensamblar
 * con IA" button appears in Diana's Ensamblador (it only shows when editable =
 * draft | corrections_needed). The AI auto-assembly itself must run in the browser
 * (getCaseWorkspace uses request cookies), so this only seeds the draft.
 *
 * Usage: npx -y tsx docs/_evidence/f-karelis/new-draft-expediente.ts
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CASE_ID = "559220ae-796b-4110-ab45-bfc7eea6a564";
const HENRY_ADMIN = "00000000-0000-0000-0000-000000000001";

(async () => {
  const exp = await import("../../../src/backend/modules/expediente");
  const { createServiceClient } = await import("../../../src/backend/platform/supabase");
  const sb = createServiceClient();
  const { data: c } = await sb.from("cases").select("org_id").eq("id", CASE_ID).single();
  const actor = { userId: HENRY_ADMIN, orgId: (c as { org_id: string }).org_id, kind: "staff" as const, role: "admin" as const, permissions: new Map() };

  const rows = await (exp as { getCaseExpedientes: (a: unknown, id: string) => Promise<Array<{ id: string; status: string; attempt_no: number }>> }).getCaseExpedientes(actor, CASE_ID);
  let draft = rows.find((r) => r.status === "draft" || r.status === "corrections_needed");
  if (!draft) {
    draft = await (exp as { createExpediente: (a: unknown, i: { caseId: string }) => Promise<{ id: string; status: string; attempt_no: number }> }).createExpediente(actor, { caseId: CASE_ID });
  }
  console.log(JSON.stringify({ draftId: draft.id, attempt: draft.attempt_no, status: draft.status }, null, 2));
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
