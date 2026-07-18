/* Fase 2.1 — Create a real asilo-politico case (fake data) via create_case_atomic.
 *  provisionClientUser -> createCaseAtomic (same atomic RPC the app uses) -> I-589 response row.
 *  We build the RPC payload directly (skipping the SSR-bound findClientFullName /
 *  contract-document snapshot, which are only for the signing page, irrelevant to a test).
 *  Writes prod-verify/asilo-ids.json. Run: npx -y tsx docs/_evidence/prod-verify/10-setup-asilo.ts
 */
import * as fs from "fs";
import * as path from "path";
import { loadEnv, IDS, staffAdminActor } from "./_env";
loadEnv();

const CLIENT_EMAIL = "karelis.asilo.demo@example.com";
const OUT = path.resolve(__dirname, "asilo-ids.json");
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

  // 1) Client (idempotent by email)
  console.log(`[${ts()}] provisionClientUser…`);
  const client = await identity.provisionClientUser(actor, {
    fullName: "Karelis Andreína Pérez",
    email: CLIENT_EMAIL,
    phoneE164: "+13055550142",
    address: { line1: "8425 NW 53rd Street", city: "Doral", state: "FL", zip: "33166", apartment: "12" },
    locale: "es",
    timezone: "America/New_York",
  });
  console.log(`[${ts()}] client ${client.userId} (created=${client.created})`);

  // 2) Case — reuse if this client already has an asilo case, else create atomically.
  const { data: dupe } = await sb
    .from("cases").select("id, case_number")
    .eq("primary_client_id", client.userId).eq("service_id", IDS.ASILO_SERVICE).maybeSingle();
  let caseId: string;
  if (dupe) {
    caseId = dupe.id;
    console.log(`[${ts()}] reusing existing asilo case ${dupe.case_number} (${caseId})`);
  } else {
    const caseNumber = await repo.nextCaseNumber(IDS.ORG);
    const total = 150000, down = 15000, count = 9;
    console.log(`[${ts()}] createCaseAtomic ${caseNumber}…`);
    const atomic = await repo.createCaseAtomic({
      case: {
        org_id: IDS.ORG, case_number: caseNumber, service_id: IDS.ASILO_SERVICE,
        service_plan_id: IDS.ASILO_PLAN_SELF, current_phase_id: null, status: "payment_pending",
        primary_client_id: client.userId, assigned_paralegal_id: null, assigned_sales_id: IDS.VANESSA_SALES,
      },
      member: { user_id: client.userId, access_role: "owner" },
      parties: [{ person_record_id: null, user_id: client.userId, party_role: "petitioner", position: 0 }],
      contract: {
        org_id: IDS.ORG, lead_id: null, service_id: IDS.ASILO_SERVICE, service_plan_id: IDS.ASILO_PLAN_SELF,
        status: "draft",
        plan_snapshot: { planKind: "self", totalCents: total, downpaymentCents: down, installmentCount: count, frequency: "monthly", currency: "USD" },
        parties_snapshot: { parties: [{ userId: client.userId, name: "Karelis Andreína Pérez", role: "petitioner" }] },
        document_snapshot: {},
        created_by: IDS.HENRY_ADMIN, terms_version: null, signing_token: null, signing_expires_at: null,
      },
      plan: { total_cents: total, downpayment_cents: down, installment_count: count, frequency: "monthly", notes: null },
      installments: buildInstallments(total, down, count),
    });
    caseId = atomic.caseId;
    console.log(`[${ts()}] case created ${caseId} number=${caseNumber}`);
  }

  // Activate case + set current phase (a fresh atomic case starts payment_pending with no phase).
  await sb.from("cases").update({
    status: "active", current_phase_id: IDS.ASILO_PHASE_PRINCIPAL, current_stage: "legal",
    assigned_paralegal_id: IDS.DIANA_LEGAL, current_owner_id: IDS.DIANA_LEGAL,
  }).eq("id", caseId);

  const { data: caseRow } = await sb.from("cases").select("case_number, org_id").eq("id", caseId).single();

  // 3) I-589 response row (draft)
  const { data: existingResp } = await sb
    .from("case_form_responses").select("id")
    .eq("case_id", caseId).eq("form_definition_id", IDS.I589_FORM).is("party_id", null).maybeSingle();
  let i589ResponseId: string;
  if (existingResp) {
    i589ResponseId = existingResp.id;
    console.log(`[${ts()}] reusing I-589 response ${i589ResponseId}`);
  } else {
    const { data: ins, error } = await sb.from("case_form_responses").insert({
      case_id: caseId, form_definition_id: IDS.I589_FORM, automation_version_id: IDS.I589_VERSION_PUBLISHED,
      service_phase_id: IDS.ASILO_PHASE_PRINCIPAL, party_id: null, status: "draft", answers: {},
    }).select("id").single();
    if (error) throw new Error("insert I-589 response: " + error.message);
    i589ResponseId = ins.id;
    console.log(`[${ts()}] I-589 response created ${i589ResponseId}`);
  }

  const out = { caseId, caseNumber: caseRow?.case_number, orgId: caseRow?.org_id, clientId: client.userId, i589ResponseId };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n[${ts()}] ✅ asilo case ready:`, out);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
