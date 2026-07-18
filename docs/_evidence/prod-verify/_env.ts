/* Shared env loader for the prod-verify scripts. Loads .env.local into process.env.
 * IMPORTANT: leaves NEXT_PUBLIC_APP_URL as-is (localhost) so SEEDING scripts do NOT
 * publish jobs to prod QStash (notification enqueues fall back to a harmless local
 * self-dispatch). The memo trigger script overrides NEXT_PUBLIC_APP_URL explicitly to
 * hit the real prod webhook.
 */
import * as fs from "fs";
import * as path from "path";

export function loadEnv(): void {
  const envPath = path.resolve(__dirname, "../../../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const IDS = {
  ORG: "a3e5f333-455a-4b3b-a5da-5a3716d24761",
  HENRY_ADMIN: "00000000-0000-0000-0000-000000000001",
  VANESSA_SALES: "00000000-0000-0000-0000-000000000002",
  DIANA_LEGAL: "00000000-0000-0000-0000-000000000003",
  PROD_URL: "https://x-legal.usalatinoprime.com",
  // asilo-politico
  ASILO_SERVICE: "344b44c9-0800-456d-87f7-d5c29e537d1b",
  ASILO_PHASE_PRINCIPAL: "10218501-fde6-488a-a11a-8b9ed4c41fc6",
  ASILO_PLAN_SELF: "c8050bb6-bb50-4316-850c-aee185c0fc4d",
  I589_FORM: "e7f12a89-d1dd-4478-84f3-17afff5a0b8d",
  I589_VERSION_PUBLISHED: "7de5f9de-6abe-4aa0-bb74-755eb38de867",
  MEMO_ASILO_FORM: "b8ecfc63-323f-49e8-9e34-40679b9717a9",
  MEMO_ASILO_QUESTIONNAIRE_FORM: "138f4f0e-88fb-4694-baa0-2981964d8bfc",
  DOC_DECLARACION_ASILO: "b1ad0ea0-3c2d-4e97-a54f-685cb0daafe6",
  DOC_EVIDENCIAS_ASILO: "c91ca7e1-716c-4bdd-8798-ea0c77c36b39",
  // reforzar-asilo
  REFORZAR_SERVICE: "42634670-062b-443d-a710-63593f7c06d4",
  REFORZAR_PHASE: "53160171-81b5-472c-ac55-f73c6c095228",
  REFORZAR_CASE: "2c3b1cd3-b62c-49e6-b9e1-5cca347a6c68", // U26-000027 (existing, empty)
  REFORZAR_CLIENT: "08d47713-aeec-49de-aa66-66e91c800ce8",
  MEMO_REFORZAR_FORM: "1515e7d6-b356-4777-afc3-934208b92f09",
  MEMO_REFORZAR_QUESTIONNAIRE_FORM: "65185b35-8129-4c92-98dd-a89871229c62",
  DOC_DECLARACION_REFORZAR: "5a28333b-e07d-45a2-83a2-7398ab411814",
  DOC_EVIDENCIAS_REFORZAR: "5b5bdd7d-9226-417f-a775-10988b009c86",
  DOC_I589_PRESENTADO_REFORZAR: "cce0763a-2bd7-420d-b5b1-1bb5dd05605d",
} as const;

export function staffAdminActor(orgId: string) {
  return { userId: IDS.HENRY_ADMIN, orgId, kind: "staff" as const, role: "admin" as const, permissions: new Map() };
}
