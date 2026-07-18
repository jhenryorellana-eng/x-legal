/* Fase 2.2 — Create a FRESH reforzar-asilo case (fake data) via create_case_atomic.
 * We do NOT reuse U26-000027 (that belongs to a real-looking client). Distinct persona:
 * Salvadoran woman who already filed her I-589, fleeing MS-13 gang persecution.
 * Writes prod-verify/reforzar-ids.json. Run: npx -y tsx docs/_evidence/prod-verify/70-setup-reforzar.ts */
import * as fs from "fs";
import * as path from "path";
import { loadEnv, IDS, staffAdminActor } from "./_env";
loadEnv();

const CLIENT_EMAIL = "yenifer.reforzar.demo@example.com";
const REFORZAR_PLAN_SELF = "8a6ded41-87c5-4d72-83a5-a9fa4f990029";
const OUT = path.resolve(__dirname, "reforzar-ids.json");
const ts = () => new Date().toISOString().slice(11, 19);

function buildInstallments(totalCents: number, downCents: number, count: number) {
  const rest = totalCents - downCents;
  const per = Math.round(rest / (count - 1));
  const out = [{ number: 1, is_downpayment: true, amount_cents: downCents, due_date: new Date().toISOString().slice(0, 10), status: "pending" }];
  let acc = downCents;
  for (let i = 2; i <= count; i++) {
    const amt = i === count ? totalCents - acc : per;
    acc += amt;
    const d = new Date(); d.setMonth(d.getMonth() + (i - 1));
    out.push({ number: i, is_downpayment: false, amount_cents: amt, due_date: d.toISOString().slice(0, 10), status: "pending" });
  }
  return out;
}

(async () => {
  const identity = await import("../../../src/backend/modules/identity");
  const repo = await import("../../../src/backend/modules/cases/repository");
  const { createServiceClient } = await import("../../../src/backend/platform/supabase");
  const sb = createServiceClient();
  const actor = staffAdminActor(IDS.ORG);

  console.log(`[${ts()}] provisionClientUser…`);
  const client = await identity.provisionClientUser(actor, {
    fullName: "Yenifer del Carmen Rodríguez Alvarado",
    email: CLIENT_EMAIL,
    phoneE164: "+13055550188",
    address: { line1: "1490 SW 8th Street", city: "Miami", state: "FL", zip: "33135", apartment: "3" },
    locale: "es", timezone: "America/New_York",
  });
  console.log(`[${ts()}] client ${client.userId} (created=${client.created})`);

  const { data: dupe } = await sb.from("cases").select("id, case_number").eq("primary_client_id", client.userId).eq("service_id", IDS.REFORZAR_SERVICE).maybeSingle();
  let caseId: string;
  if (dupe) { caseId = dupe.id; console.log(`[${ts()}] reusing reforzar case ${dupe.case_number} (${caseId})`); }
  else {
    const caseNumber = await repo.nextCaseNumber(IDS.ORG);
    const total = 90000, down = 18000, count = 8;
    console.log(`[${ts()}] createCaseAtomic ${caseNumber}…`);
    const atomic = await repo.createCaseAtomic({
      case: { org_id: IDS.ORG, case_number: caseNumber, service_id: IDS.REFORZAR_SERVICE, service_plan_id: REFORZAR_PLAN_SELF, current_phase_id: null, status: "payment_pending", primary_client_id: client.userId, assigned_paralegal_id: null, assigned_sales_id: IDS.VANESSA_SALES },
      member: { user_id: client.userId, access_role: "owner" },
      parties: [{ person_record_id: null, user_id: client.userId, party_role: "petitioner", position: 0 }],
      contract: { org_id: IDS.ORG, lead_id: null, service_id: IDS.REFORZAR_SERVICE, service_plan_id: REFORZAR_PLAN_SELF, status: "draft", plan_snapshot: { planKind: "self", totalCents: total, downpaymentCents: down, installmentCount: count, frequency: "monthly", currency: "USD" }, parties_snapshot: { parties: [{ userId: client.userId, name: "Yenifer del Carmen Rodríguez Alvarado", role: "petitioner" }] }, document_snapshot: {}, created_by: IDS.HENRY_ADMIN, terms_version: null, signing_token: null, signing_expires_at: null },
      plan: { total_cents: total, downpayment_cents: down, installment_count: count, frequency: "monthly", notes: null },
      installments: buildInstallments(total, down, count),
    });
    caseId = atomic.caseId;
    console.log(`[${ts()}] case created ${caseId} number=${caseNumber}`);
  }

  await sb.from("cases").update({ status: "active", current_phase_id: IDS.REFORZAR_PHASE, current_stage: "legal", assigned_paralegal_id: IDS.DIANA_LEGAL, current_owner_id: IDS.DIANA_LEGAL }).eq("id", caseId);
  const { data: caseRow } = await sb.from("cases").select("case_number, org_id").eq("id", caseId).single();

  const out = { caseId, caseNumber: caseRow?.case_number, orgId: caseRow?.org_id, clientId: client.userId };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n[${ts()}] ✅ reforzar case ready:`, out);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
