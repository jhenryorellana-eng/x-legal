/* Phase 1 root-cause repro: call proposeExpedienteAssembly (pure ai-engine, no SSR) with the
 * REAL reforzar context and print the plan or the exact error, N times (flakiness vs deterministic).
 * Run: npx -y tsx docs/_evidence/prod-verify/86-planner-repro.ts [runs] */
import { loadEnv } from "./_env";
loadEnv();
const RUNS = Number(process.argv[2] || 3);
const ts = () => new Date().toISOString().slice(11, 19);

const input = {
  caseLabel: "U26-000032",
  serviceCategory: "Reforzar Asilo",
  parties: [{ id: "20433225-6a9f-4f52-889c-5f3690e26056", role: "petitioner", name: "Yenifer del Carmen Rodríguez Alvarado" }],
  strongDocs: [{ kind: "ai_generation" as const, id: "8615dc23-8452-4601-be75-e35c4e3a77a5", label: "Memorándum de Miedo Creíble", partyId: null }],
  documents: [
    { caseDocumentId: "b0aea7fe-6452-4562-be7d-dace55c2c7b7", fileName: "Formulario I-589 completo (presentado)", partyId: null, requirementLabel: "Formulario I-589 completo (con anexos)" },
    { caseDocumentId: "e67ee7ea-0248-45d8-b74c-3513ba4cf075", fileName: "Declaración jurada de Yenifer", partyId: null, requirementLabel: "Declaración jurada (affidavit)" },
    { caseDocumentId: "95541a74-747a-4298-91e4-026d98f36048", fileName: "Evidencias sustentatorias - Paquete consolidado A-D", partyId: null, requirementLabel: "Evidencias sustentatorias" },
    { caseDocumentId: "30ef89d4-307c-486e-b07d-8f4981dda688", fileName: "Evidencia D - Condiciones del pais", partyId: null, requirementLabel: "Evidencias sustentatorias" },
    { caseDocumentId: "2aa5cebd-ba3a-4b32-a59e-5da38c2296f8", fileName: "Evidencia C - Nota de amenaza", partyId: null, requirementLabel: "Evidencias sustentatorias" },
    { caseDocumentId: "b82161d3-3a07-4ccf-bc9b-26697657c270", fileName: "Evidencia B - Acta de homicidio", partyId: null, requirementLabel: "Evidencias sustentatorias" },
    { caseDocumentId: "138774f4-90dc-4e57-b300-f699cbeaf117", fileName: "Evidencia A - Denuncia PNC", partyId: null, requirementLabel: "Evidencias sustentatorias" },
  ],
};

(async () => {
  const ai = await import("../../../src/backend/modules/ai-engine");
  for (let i = 1; i <= RUNS; i++) {
    try {
      const plan = await ai.proposeExpedienteAssembly(input as never);
      const secs = (plan as { sections: unknown[] }).sections;
      console.log(`[${ts()}] run ${i}: ✅ OK — ${secs.length} sections: ${JSON.stringify(secs).slice(0, 300)}`);
    } catch (e) {
      console.log(`[${ts()}] run ${i}: ⛔ ${(e as Error).name}: ${(e as Error).message}`);
    }
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
