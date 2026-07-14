/**
 * Mock data for the F2-W2-b admin casos preview (Playwright evidence only).
 * Dev-only — imported solely by the admin-preview route which 404s in prod.
 */

import { buildCasosStrings } from "@/frontend/features/shared-case";
import type { CaseRowVM } from "@/frontend/features/admin/casos/casos-list-view";
import type { NewCaseService } from "@/frontend/features/admin/casos/new-case-modal";
import type { CaseWorkspaceVM } from "@/frontend/features/shared-case";

export const casosStringsMock = buildCasosStrings("es");

export const casoRowsMock: CaseRowVM[] = [
  {
    id: "c1",
    caseNumber: "U26-000042",
    clientName: "María González",
    serviceLabel: "Asilo Político",
    planKind: "with_lawyer",
    phaseLabel: "Preparación del expediente",
    phasePos: 3,
    phaseTotal: 5,
    status: "in_validation",
    statusPill: "revision",
    statusLabel: casosStringsMock.status.in_validation,
    openedRel: "hace 4 meses",
  },
  {
    id: "c2",
    caseNumber: "U26-000061",
    clientName: "Carlos Pérez",
    serviceLabel: "Visa Juvenil",
    planKind: "self",
    phaseLabel: "Recolección de documentos",
    phasePos: 1,
    phaseTotal: 4,
    status: "active",
    statusPill: "aprobado",
    statusLabel: casosStringsMock.status.active,
    openedRel: "hace 12 días",
  },
  {
    id: "c3",
    caseNumber: "U26-000070",
    clientName: "Yeimi Castillo",
    serviceLabel: "Asilo Político",
    planKind: "with_lawyer",
    phaseLabel: "—",
    phasePos: 0,
    phaseTotal: 0,
    status: "payment_pending",
    statusPill: "pendiente",
    statusLabel: casosStringsMock.status.payment_pending,
    openedRel: "hace 2 días",
  },
  {
    id: "c4",
    caseNumber: "U25-000388",
    clientName: "Pedro Alvarado",
    serviceLabel: "Visa Juvenil",
    planKind: "self",
    phaseLabel: "Entrega",
    phasePos: 4,
    phaseTotal: 4,
    status: "on_hold",
    statusPill: "amber",
    statusLabel: casosStringsMock.status.on_hold,
    openedRel: "hace 7 meses",
  },
];

export const newCaseServicesMock: NewCaseService[] = [
  {
    id: "svc-asilo",
    label: "Asilo Político",
    plans: [
      {
        kind: "with_lawyer",
        label: casosStringsMock.planWith,
        priceCents: 500000,
        downpaymentCents: 125000,
        installments: 4,
        frequency: "monthly",
      },
      {
        kind: "self",
        label: casosStringsMock.planSelf,
        priceCents: 250000,
        downpaymentCents: 60000,
        installments: 4,
        frequency: "monthly",
      },
    ],
    encodedByKind: {
      with_lawyer: "svc-asilo|plan-wl|500000|125000|4|monthly",
      self: "svc-asilo|plan-self|250000|60000|4|monthly",
    },
    partyRoles: [
      { roleKey: "spouse", label: "Cónyuge", cardinality: "single", required: false },
      { roleKey: "minor", label: "Hijos", cardinality: "multiple", required: false },
    ],
  },
  {
    id: "svc-sijs",
    label: "Visa Juvenil (SIJS)",
    plans: [
      {
        kind: "self",
        label: casosStringsMock.planSelf,
        priceCents: 360000,
        downpaymentCents: 60000,
        installments: 6,
        frequency: "weekly",
      },
    ],
    encodedByKind: { self: "svc-sijs|plan-sijs|360000|60000|6|weekly" },
    partyRoles: [],
  },
];

export const caseWorkspaceVmMock: CaseWorkspaceVM = {
  header: {
    caseId: "c1",
    caseNumber: "U26-000042",
    clientName: "María González",
    clientPhone: "+1 305 555 0142",
    serviceLabel: "Asilo Político",
    planKind: "with_lawyer",
    status: "payment_pending",
    statusPill: "pendiente",
    statusLabel: casosStringsMock.status.payment_pending,
    isPaymentPending: true,
    hasPhase: false,
    contractStatus: "sent",
    contractId: "ctr-1",
    phaseLabel: null,
    phaseIndex: 0,
    phaseCount: 4,
    phaseProgress: 0,
  },
  role: "admin",
  isAdmin: true,
  requiresLawyerValidation: true,
  documents: [
    { id: "d1", filename: "Pasaporte de María.pdf", status: "uploaded", partyName: "María González", createdAt: new Date().toISOString() },
    { id: "d2", filename: "Acta de nacimiento.pdf", status: "rejected", partyName: null, createdAt: new Date().toISOString() },
    { id: "d3", filename: "Comprobante de domicilio.pdf", status: "approved", partyName: null, createdAt: new Date().toISOString() },
  ],
  requirements: [
    { key: "r1", requirementId: "req-1", partyId: null, partyName: null, label: "Pasaporte", category: "Identidad", isRequired: true, isHidden: false, status: "revision", documentId: "d1", rejectionReason: null, allowMultiple: false, uploads: [{ documentId: "d1", displayName: "Pasaporte", status: "revision", rejectionReason: null, mimeType: "application/pdf" }] },
    { key: "r2", requirementId: "req-2", partyId: null, partyName: null, label: "Comprobante de domicilio", category: "Identidad", isRequired: false, isHidden: false, status: "pendiente", documentId: null, rejectionReason: null, allowMultiple: false, uploads: [] },
  ],
  docsApproved: 1,
  docsTotal: 3,
  parties: [
    { id: "p1", name: "María González", role: "Titular" },
    { id: "p2", name: "Diego González", role: "Cónyuge" },
    { id: "p3", name: "Sofía González", role: "Hija" },
  ],
  installments: [
    { id: "i1", number: 1, amountCents: 125000, status: "pending", isDownpayment: true, dueDate: null, payments: [] },
    { id: "i2", number: 2, amountCents: 125000, status: "pending", isDownpayment: false, dueDate: "2026-07-15", payments: [] },
    { id: "i3", number: 3, amountCents: 125000, status: "pending", isDownpayment: false, dueDate: "2026-08-15", payments: [] },
    { id: "i4", number: 4, amountCents: 125000, status: "pending", isDownpayment: false, dueDate: "2026-09-15", payments: [] },
  ],
  planFrequency: "monthly",
  planAutopayEnabled: false,
  planAutopayDisabledReason: null,
  downpaymentInstallmentId: "i1",
  downpaymentAmountCents: 125000,
  timeline: [
    { id: "t1", title: "Contrato enviado para firma", occurredAt: new Date().toISOString(), actorKind: "team", icon: "file-signature" },
    { id: "t2", title: "Caso creado", occurredAt: new Date().toISOString(), actorKind: "team", icon: "file-plus" },
  ],
  forms: [
    { id: "f1", fillFormDefinitionId: "f1", kind: "pdf_automation", label: "Datos del solicitante", status: "approved", partyId: "p1", partyName: "María González", filledBy: "client", responseId: "r-f1", hasPdf: true },
    { id: "f2", fillFormDefinitionId: "f2", kind: "ai_letter", label: "Relato de asilo", status: "draft", partyId: null, partyName: null, filledBy: "client", responseId: null, hasPdf: false },
  ],
  formsDone: 1,
  formsTotal: 2,
  generations: [
    { id: "g1", formDefinitionId: "l1", formLabel: "Memorándum de asilo", status: "completed", version: 2, costUsd: 0.42, isCurrent: true, partyId: null, partyName: null, outputAvailable: true, createdAt: new Date().toISOString() },
    { id: "g2", formDefinitionId: "l2", formLabel: "Carta de testigo", status: "running", version: 1, costUsd: null, isCurrent: false, partyId: "p1", partyName: "María González", outputAvailable: false, createdAt: new Date().toISOString() },
  ],
  validations: [
    { id: "v1", attemptNo: 1, status: "needs_corrections", semaforo: "amber", aiScore: 78, verdict: "needs_corrections", createdAt: new Date().toISOString() },
  ],
  expedientes: [
    { id: "e1", attemptNo: 1, status: "compiled", pageCount: 42, createdAt: new Date().toISOString() },
  ],
};
