"use client";

import * as React from "react";
import { MODULE_KEYS } from "@/shared/constants/modules";
import { ROLE_PRESETS } from "@/shared/constants/role-presets";
import { EmployeesView } from "@/frontend/features/admin/employees/employees-view";
import { CatalogListView } from "@/frontend/features/admin/catalog/catalog-list-view";
import { CatalogWizard } from "@/frontend/features/admin/catalog/catalog-wizard";
import { AuditClient } from "@/frontend/features/admin/audit/audit-client";
import { ConfigView } from "@/frontend/features/admin/config/config-view";
import { CasosListView } from "@/frontend/features/admin/casos/casos-list-view";
import { SharedCaseView } from "@/frontend/features/shared-case";
import { SigningView } from "@/app/(public)/firma/[token]/signing-view";
import { buildSigningStrings } from "@/app/(public)/firma/[token]/strings";
import { BrandToaster } from "@/frontend/components/desktop";
import { FormEditorView, FORM_EDITOR_STRINGS_ES, type FormEditorActions } from "@/frontend/features/admin/form-editor";
import { DatasetsListView, DatasetDetailView } from "@/frontend/features/admin/datasets";
import { AiCostsView } from "@/frontend/features/admin/ai-costs";
import {
  formEditorPdfMock,
  formEditorAiMock,
  datasetsListMock,
  datasetHeaderMock,
  datasetItemsMock,
  datasetUsageMock,
  aiCostsMock,
  aiCostsStringsMock,
} from "../f4-mock";
import {
  employeesMock,
  employeesMessages,
  catalogMessages,
  servicesMock,
  auditMessages,
  auditRowsMock,
  auditActorsMock,
  configMessages,
  orgMock,
  coversMock,
  termsMock,
  acceptancesMock,
  timezonesMock,
} from "../mock";
import {
  casosStringsMock,
  casoRowsMock,
  newCaseServicesMock,
  caseWorkspaceVmMock,
} from "../casos-mock";

const noopRes = async () => ({ success: true as const });
const noopOkRes = async () => ({ ok: true as const });

/**
 * Dev-only preview switcher (Playwright evidence). Renders each admin view with
 * mock data + no-op actions. Never reachable in production (the page 404s).
 */
export function PreviewClient({ view }: { view: string }) {
  // The firma (public signing) surface uses MOBILE tokens — render it OUTSIDE
  // the .surface-staff scope.
  if (view === "firma") {
    return (
      <div data-theme-scope style={{ minHeight: "100dvh", background: "var(--bg)" }}>
        <BrandToaster />
        <FirmaPreview />
      </div>
    );
  }

  return (
    <div className="surface-staff" data-theme-scope style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <BrandToaster />
      {view === "empleados" && (
        <EmployeesView
          employees={employeesMock}
          moduleKeys={MODULE_KEYS}
          rolePresets={Object.fromEntries(
            Object.entries(ROLE_PRESETS).map(([role, m]) => [role, m]),
          )}
          messages={employeesMessages}
          actions={{ invite: noopOkRes, updatePermissions: noopOkRes, setActive: noopOkRes }}
        />
      )}

      {view === "catalogo" && (
        <CatalogListView
          services={servicesMock}
          messages={catalogMessages}
          newServiceHref="#"
          serviceBasePath="#"
          actions={{ archive: noopRes, restore: noopRes, setActive: noopRes, setPublic: noopRes }}
        />
      )}

      {view === "auditoria" && (
        <AuditClient
          initialRows={auditRowsMock}
          initialNextCursor={null}
          actors={auditActorsMock}
          entityTypes={["services", "form_automation_versions", "payments", "cases", "staff"]}
          messages={auditMessages}
          actions={{
            loadPage: async () => ({ ok: true, items: auditRowsMock, nextCursor: null }),
            exportCsv: async () => ({ ok: true, csv: "id,action\n" }),
          }}
        />
      )}

      {view === "nuevo-servicio" && (
        <CatalogWizard
          service={null}
          plans={[]}
          partyRoles={[]}
          phases={[]}
          stageSlas={{ sales: null, legal: null, operations: null }}
          deadlinePolicy={null}
          externalTool={null}
          slugLocked={false}
          messages={catalogMessages}
          listHref="#"
          actions={{
            createService: async () => ({ success: true, data: { id: "new" } }),
            updateService: noopRes,
            uploadSignatureUrl: async () => ({ success: true, data: { signedUrl: "#", path: "mock/sig.png" } }),
            getSignaturePreviewUrl: async () => ({ success: true, data: null }),
            upsertPlan: noopRes,
            createPhase: async () => ({ success: true, data: { id: "p1" } }),
            updatePhase: noopRes,
            deletePhase: noopRes,
            upsertPolicy: noopRes,
            upsertSchedule: noopRes,
            saveStageSlas: noopRes,
            saveDeadlinePolicy: noopRes,
            saveExternalTool: noopRes,
            upsertMilestones: noopRes,
            createRequiredDoc: async () => ({ success: true, data: { id: "mock-doc" } }),
            updateRequiredDoc: async () => ({ success: true, data: { id: "mock-doc" } }),
            createPartyRole: async () => ({ success: true, data: { id: "mock-role" } }),
            updatePartyRole: noopRes,
            deletePartyRole: noopRes,
            createForm: async () => ({ success: true, data: { id: "mock-form" } }),
            updateForm: noopRes,
            activate: async () => ({ success: true, data: { ok: true, issues: [] } }),
            proposeExtractionSchema: async () => ({
              success: true,
              data: { type: "object", properties: {} },
            }),
            validateExtractionSchema: async () => ({ success: true, data: { valid: true } }),
          }}
        />
      )}

      {view === "configuracion" && (
        <ConfigView
          org={orgMock}
          covers={coversMock}
          terms={termsMock}
          acceptances={acceptancesMock}
          timezones={timezonesMock}
          messages={configMessages}
          actions={{ saveOrg: noopRes, setCoverActive: noopRes, createTerms: noopRes, publishTerms: noopRes }}
        />
      )}

      {view === "casos" && (
        <div style={{ padding: 28 }}>
          <CasosListView
            rows={casoRowsMock}
            total={casoRowsMock.length}
            hasMore={false}
            nextCursor={null}
            services={newCaseServicesMock}
            strings={casosStringsMock}
            detailBasePath="#"
            newCaseActions={{
              createCase: async () => ({
                ok: true,
                signingToken: "preview-token-demo-1234",
                signingUrl: "https://x-legal.usalatinoprime.com/firma/preview-token-demo-1234",
              }),
              searchClients: async () => ({
                ok: true,
                results: [
                  {
                    userId: "00000000-0000-0000-0000-000000000301",
                    name: "María González",
                    email: "maria.gonzalez.demo@example.com",
                    phone: "+13055550301",
                    address: { line1: "123 Main St", city: "Miami", state: "FL", zip: "33101" },
                    caseCount: 1,
                  },
                ],
              }),
              getClientCases: async () => ({ ok: true, cases: [] }),
            }}
          />
        </div>
      )}

      {view === "caso-detalle" && (
        <div style={{ padding: 28 }}>
          <SharedCaseView
            vm={caseWorkspaceVmMock}
            actions={{
              reviewDocument: noopOkRes,
              registerPayment: noopOkRes,
              resendSigningLink: noopOkRes,
              sendContract: noopOkRes,
              getDocumentUrl: async () => ({ ok: true, url: "#" }),
              startUpload: async () => ({ ok: true, signedUrl: "#", uploadRef: "x" }),
              confirmUpload: noopOkRes,
            }}
            strings={casosStringsMock}
            locale="es"
            backHref="#"
            isAdmin
          />
        </div>
      )}

      {view === "form-editor-pdf" && (
        <FormEditorView vm={formEditorPdfMock} strings={FORM_EDITOR_STRINGS_ES} actions={formEditorNoopActions} lang="es" datasetsHref="#" />
      )}

      {view === "form-editor-ai" && (
        <FormEditorView vm={formEditorAiMock} strings={FORM_EDITOR_STRINGS_ES} actions={formEditorNoopActions} lang="es" datasetsHref="#" />
      )}

      {view === "datasets" && (
        <DatasetsListView
          rows={datasetsListMock}
          detailBasePath="#"
          actions={{ create: async () => ({ success: true, data: { id: "new" } }), setActive: noopRes, remove: noopRes }}
        />
      )}

      {view === "dataset-detalle" && (
        <DatasetDetailView
          header={datasetHeaderMock}
          items={datasetItemsMock}
          usage={datasetUsageMock}
          initialTab="items"
          catalogBasePath="#"
          actions={{
            createItem: async () => ({ success: true, data: { id: "it-new", token_count: 2400 } }),
            deleteItem: noopRes,
            createUploadUrl: async () => ({ success: true, data: { signedUrl: "#", path: "x" } }),
          }}
        />
      )}

      {view === "ai-costs" && <AiCostsView vm={aiCostsMock} strings={aiCostsStringsMock} />}
    </div>
  );
}

const formEditorNoopActions: FormEditorActions = {
  createUploadUrl: async () => ({ success: true, data: { signedUrl: "#", path: "x" } }),
  createVersion: async () => ({ success: true }),
  redetect: async () => ({ success: true }),
  getPdfUrl: async () => ({ success: true, data: null }),
  aiPropose: async () => ({ success: true, data: { groups: 3, questions: 12 } }),
  upsertGroup: async () => ({ success: true, data: { id: "g-new" } }),
  deleteGroup: async () => ({ success: true }),
  upsertQuestion: async () => ({ success: true, data: { id: "q-new" } }),
  updateQuestionAiImprove: async () => ({ success: true }),
  deleteQuestion: async () => ({ success: true }),
  generateTestPdf: async () => ({ success: true, data: { pdfBase64: "", gaps: [] } }),
  publish: async () => ({ success: true, data: { ok: false, issues: [{ code: "CATALOG_PDF_FIELD_UNMAPPED", severity: "warning", detail: "Pt3Line1_Signature · pág. 3 sin pregunta" }] } }),
  unpublish: async () => ({ success: true }),
  duplicateVersion: async () => ({ success: true, data: { id: "ver-draft-new" } }),
  setVersionEmptyPolicy: async () => ({ success: true }),
  saveGenerationConfig: async () => ({ success: true }),
  saveQuestionnaireGenConfig: async () => ({ success: true }),
  savePreMortemGuide: async () => ({ success: true }),
  testGeneration: async () => ({ success: true, data: { run_id: "run-demo-001" } }),
  ensureCompanionQuestionnaire: async () => ({ success: true, data: { id: "form-q-demo", slug: "demo-cuestionario", created: true } }),
};

/** Public signing surface preview (mobile tokens). */
function FirmaPreview() {
  const strings = buildSigningStrings("es");
  return (
    <SigningView
      token="preview-token"
      locale="es"
      strings={strings}
      serviceLabel="Asilo Político"
      planKind="with_lawyer"
      totalCents={500000}
      currency="USD"
      installments={[
        { number: 1, amountCents: 125000, isDownpayment: true },
        { number: 2, amountCents: 125000, dueDate: "15 jul 2026" },
        { number: 3, amountCents: 125000, dueDate: "15 ago 2026" },
        { number: 4, amountCents: 125000, dueDate: "15 sep 2026" },
      ]}
      parties={[
        { name: "María González", role: "Titular" },
        { name: "Diego González", role: "Cónyuge" },
      ]}
      document={null}
      termsVersion="v1.0"
      signAction={async () => ({ ok: true, outcome: "signed" as const })}
    />
  );
}

