/**
 * Mock data for the F4 form-editor / datasets / ai-costs preview views.
 * Imported ONLY by the (dev)/admin-preview route (404s in production).
 */

import type { FormEditorVM } from "@/frontend/features/admin/form-editor";
import type { DatasetRowVM } from "@/frontend/features/admin/datasets";
import type { DatasetItemVM, DatasetUsageVM, DatasetHeaderVM } from "@/frontend/features/admin/datasets/dataset-detail-view";
import type { AiCostsVM } from "@/frontend/features/admin/ai-costs";

// I-360 sample (DOC-53 §5 §4 example data).
const detectedFields = [
  { pdf_field_name: "Pt1Line1a_FamilyName", field_type: "text" as const, page: 1, rect: [60, 680, 280, 700] as [number, number, number, number] },
  { pdf_field_name: "Pt1Line1b_GivenName", field_type: "text" as const, page: 1, rect: [300, 680, 520, 700] as [number, number, number, number] },
  { pdf_field_name: "Pt1Line2_DOB", field_type: "text" as const, page: 1, rect: [60, 640, 280, 660] as [number, number, number, number] },
  { pdf_field_name: "Pt2Checkbox_SIJ", field_type: "checkbox" as const, page: 2, rect: [60, 600, 78, 618] as [number, number, number, number] },
  { pdf_field_name: "Pt3Line1_Signature", field_type: "signature" as const, page: 3, rect: [60, 120, 300, 160] as [number, number, number, number] },
];

export const formEditorPdfMock: FormEditorVM = {
  form: {
    id: "form-i360",
    slug: "i-360",
    kind: "pdf_automation",
    label: { es: "I-360", en: "I-360" },
    serviceLabel: { es: "Visa Juvenil", en: "Juvenile Visa" },
  },
  service: { id: "svc-visa-juvenil", slug: "visa-juvenil" },
  versions: [
    { id: "v1", version: 1, status: "archived", detected_fields: detectedFields, source_pdf_path: "forms/x/v1.pdf", published_at: "2026-01-10" },
    { id: "v2", version: 2, status: "published", detected_fields: detectedFields, source_pdf_path: "forms/x/v2.pdf", published_at: "2026-04-02" },
    { id: "v3", version: 3, status: "draft", detected_fields: detectedFields, source_pdf_path: "forms/x/v3.pdf", published_at: null },
  ],
  openVersion: {
    version: { id: "v3", version: 3, status: "draft", detected_fields: detectedFields, source_pdf_path: "forms/x/v3.pdf", published_at: null },
    groups: [
      {
        id: "g1",
        automation_version_id: "v3",
        title_i18n: { es: "Datos del peticionario", en: "Petitioner data" },
        position: 0,
        questions: [
          {
            id: "q1",
            group_id: "g1",
            question_i18n: { es: "¿Cuál es tu nombre completo, tal como aparece en tu pasaporte?", en: "What is your full name, exactly as it appears on your passport?" },
            help_i18n: { es: "", en: "" },
            field_type: "text",
            options: null,
            pdf_field_name: "Pt1Line1a_FamilyName",
            source: "profile",
            source_ref: { profile_field: "last_name" },
            is_required: true,
            position: 0,
            validation: null,
          },
          {
            id: "q2",
            group_id: "g1",
            question_i18n: { es: "Fecha de nacimiento", en: "Date of birth" },
            help_i18n: { es: "", en: "" },
            field_type: "date",
            options: null,
            pdf_field_name: "Pt1Line2_DOB",
            source: "document_extraction",
            source_ref: { document_slug: "passport", json_path: "date_of_birth" },
            is_required: true,
            position: 1,
            proposed: true,
            validation: null,
          },
        ],
      },
      {
        id: "g2",
        automation_version_id: "v3",
        title_i18n: { es: "Clasificación solicitada", en: "Requested classification" },
        position: 1,
        questions: [
          {
            id: "q3",
            group_id: "g2",
            question_i18n: { es: "¿Solicitas la clasificación SIJ?", en: "Are you requesting SIJ classification?" },
            help_i18n: { es: "Special Immigrant Juvenile", en: "Special Immigrant Juvenile" },
            field_type: "checkbox",
            options: null,
            pdf_field_name: "Pt2Checkbox_SIJ",
            source: "client_answer",
            source_ref: null,
            is_required: true,
            position: 0,
            validation: null,
          },
        ],
      },
    ],
  },
  sources: {
    documents: [{ slug: "passport", paths: ["full_name", "date_of_birth", "passport_number"] }],
    forms: ["carta-apoyo"],
    profileFields: ["first_name", "last_name", "country_of_origin", "pii.ssn", "pii.a_number", "pii.passport"],
  },
  generationConfig: null,
  datasets: [
    { id: "ds1", name: "Casos ganadores EOIR 2023–2025", tokens: 96000, active: true },
    { id: "ds2", name: "Memorándums Reforzar Asilo", tokens: 41000, active: true },
  ],
};

export const formEditorAiMock: FormEditorVM = {
  ...formEditorPdfMock,
  form: {
    id: "form-memo-asilo",
    slug: "memorandum-asilo",
    kind: "ai_letter",
    label: { es: "Memorándum de asilo", en: "Asylum memorandum" },
    serviceLabel: { es: "Reforzar Asilo", en: "Strengthen Asylum" },
  },
  versions: [],
  openVersion: null,
  generationConfig: {
    system_prompt: "Eres un abogado de inmigración experto. Redacta un memorándum de asilo persuasivo usando los casos ganadores del dataset como referencia de tono y estructura.",
    input_document_slugs: ["passport"],
    input_form_slugs: [],
    dataset_id: "ds1",
    model: "claude-sonnet-4-6",
    max_output_tokens: 32000,
    output_format: "pdf",
    output_language: "both",
    web_search_enabled: false,
    web_search_max_uses: 5,
    research_instructions: null,
    research_model: null,
    sections: [],
    rules_enabled: true,
    rules_text: null,
  },
};

export const datasetsListMock: DatasetRowVM[] = [
  { id: "ds1", name: "Casos ganadores EOIR 2023–2025", purpose: "memorándum reforzar-asilo", source_kind: "eoir", item_count: 34, total_tokens: 96000, used_by: 2, is_active: true },
  { id: "ds2", name: "Memorándums Reforzar Asilo", purpose: "tono y estructura", source_kind: "manual", item_count: 12, total_tokens: 41000, used_by: 1, is_active: true },
  { id: "ds3", name: "Guías USCIS Visa Juvenil", purpose: "elegibilidad SIJ", source_kind: "uscis", item_count: 8, total_tokens: 18000, used_by: 0, is_active: false },
];

export const datasetHeaderMock: DatasetHeaderVM = {
  id: "ds1", name: "Casos ganadores EOIR 2023–2025", source_kind: "eoir", is_active: true, item_count: 34, total_tokens: 96000,
};

export const datasetItemsMock: DatasetItemVM[] = [
  { id: "it1", title: "Matter of A-B- (reapertura)", jurisdiction: "Virginia", outcome: "granted", tags: ["persecución", "pandillas", "credibilidad"], token_count: 2800 },
  { id: "it2", title: "Matter of L-E-A- (grupo social)", jurisdiction: "California", outcome: "denied", tags: ["grupo social"], token_count: 3100 },
  { id: "it3", title: "Escaneo sin OCR", jurisdiction: "Texas", outcome: null, tags: [], token_count: null },
];

export const datasetUsageMock: DatasetUsageVM[] = [
  { formId: "form-memo-asilo", formSlug: "Memorándum de asilo · Reforzar Asilo", serviceId: "svc-reforzar-asilo", phaseId: "ph1" },
  { formId: "form-carta-apoyo", formSlug: "Carta de apoyo · Asilo Político", serviceId: "svc-asilo", phaseId: "ph2" },
];

export const aiCostsMock: AiCostsVM = {
  totalUsd: 412.5,
  bySource: { generations: 318.2, extractions: 74.1, translations: 20.2 },
  byMonth: { "2026-03": 120.4, "2026-04": 158.9, "2026-05": 133.2, "2026-06": 412.5 },
  budgetUsd: 500,
  from: "2026-06-01",
  to: "2026-06-14",
};
