/**
 * Form editor view-model types (DOC-53 §5).
 *
 * Mirror of the catalog module-pub FormEditorData read, defined here so the
 * client feature never imports from @/app or @/backend (boundary R5: frontend
 * imports only frontend + shared). The RSC page maps the module read into these
 * shapes and injects the actions as props.
 */

import type { I18nValue } from "../shared/i18n-field";
import type { QuestionCondition } from "@/shared/form-logic/conditions";

export type QuestionSource =
  | "client_answer"
  | "document_extraction"
  | "generation_output"
  | "profile"
  | "ai_field";

export type FieldType = "text" | "number" | "date" | "checkbox" | "select" | "textarea";

export interface DetectedFieldVM {
  pdf_field_name: string;
  field_type: "text" | "checkbox" | "radio" | "dropdown" | "signature" | "unknown";
  page: number;
  rect: [number, number, number, number];
}

export interface QuestionOptionVM {
  value: string;
  label_i18n: I18nValue;
}

export interface QuestionVM {
  id: string;
  group_id: string;
  question_i18n: I18nValue;
  help_i18n: I18nValue;
  field_type: FieldType;
  options: QuestionOptionVM[] | null;
  pdf_field_name: string | null;
  source: QuestionSource;
  source_ref: Record<string, unknown> | null;
  is_required: boolean;
  position: number;
  validation: Record<string, unknown> | null;
  /** Conditional visibility (show/lock/require depending on another answer). */
  condition?: QuestionCondition | null;
  /** True while the question came from an AI proposal and has not been confirmed/edited. */
  proposed?: boolean;
}

export interface QuestionGroupVM {
  id: string;
  automation_version_id: string;
  title_i18n: I18nValue;
  position: number;
  questions: QuestionVM[];
}

export type VersionStatus = "draft" | "published" | "archived";

export interface VersionVM {
  id: string;
  version: number;
  status: VersionStatus;
  detected_fields: DetectedFieldVM[];
  /** NULL for a questionnaire version (no PDF). */
  source_pdf_path: string | null;
  published_at: string | null;
}

export interface SourceDocumentVM {
  slug: string;
  paths: string[];
}

export interface FormEditorVM {
  form: { id: string; slug: string; kind: "pdf_automation" | "ai_letter" | "questionnaire"; label: I18nValue; serviceLabel: I18nValue; companionQuestionnaireId: string | null };
  service: { id: string; slug: string };
  versions: VersionVM[];
  openVersion: { version: VersionVM; groups: QuestionGroupVM[] } | null;
  sources: {
    documents: SourceDocumentVM[];
    forms: string[];
    profileFields: string[];
  };
  generationConfig: GenerationConfigVM | null;
  datasets: { id: string; name: string; tokens: number; active: boolean }[];
}

export interface GenerationSectionVM {
  key: string;
  heading: string;
  min_words: number;
  max_tokens: number;
  guidance: string;
  type: "doctrinal" | "narrative" | "analysis";
  /** Optional per-section model override (e.g. Opus for the dense nexus section). */
  model?: string | null;
}

export type AssemblyBlockType = "cover" | "toc" | "body" | "chronology" | "conclusions" | "annexes" | "closing";
export interface AssemblyBlockVM {
  type: AssemblyBlockType;
  enabled: boolean;
}
export interface CoverRowVM {
  label: string;
  value: string;
}
export interface GenerationAssemblyVM {
  cover: boolean;
  toc: boolean;
  chronology: boolean;
  annexes?: boolean;
  closing: string | null;
  /** Ordered, toggleable structural blocks (preferred over the booleans above). */
  blocks?: AssemblyBlockVM[];
  /** Editable cover: title + rows (label + {{token}} value). */
  cover_page?: { title?: string; rows?: CoverRowVM[] };
}

export interface GenerationConfigVM {
  system_prompt: string;
  input_document_slugs: string[];
  input_form_slugs: string[];
  dataset_id: string | null;
  model: string;
  max_output_tokens: number;
  output_format: "pdf" | "docx" | "md";
  output_language: "es" | "en" | "both";
  // --- v1-grade engine (generic, configurable) ---
  web_search_enabled: boolean;
  pre_mortem_enabled: boolean;
  web_search_max_uses: number;
  research_instructions: string | null;
  research_model: string | null;
  sections: GenerationSectionVM[];
  rules_enabled: boolean;
  rules_text: string | null;
  assembly: GenerationAssemblyVM | null;
  // --- automatic exhibits (anexos) ---
  attach_sources_enabled: boolean;
  attach_sources_kinds: string[];
  curated_sources: { url: string; title: string; category: string }[];
}

/* Injected action shapes (structurally identical to the app server actions). */
type Res<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

export interface FormEditorActions {
  createUploadUrl: (input: { form_definition_id: string; filename: string }) => Promise<Res<{ signedUrl: string; path: string }>>;
  createVersion: (input: { form_definition_id: string; uploaded_pdf_path: string; source_language?: "en" | "es" }) => Promise<Res<unknown>>;
  redetect: (versionId: string) => Promise<Res<unknown>>;
  getPdfUrl: (versionId: string) => Promise<Res<string | null>>;
  aiPropose: (input: { version_id: string; group_id?: string; mode: "replace" | "merge"; pageRange?: { from: number; to: number } }) => Promise<Res<{ groups: number; questions: number }>>;
  upsertGroup: (input: { id?: string; automation_version_id: string; title_i18n?: Record<string, string>; position?: number }) => Promise<Res<{ id: string }>>;
  deleteGroup: (groupId: string) => Promise<Res<unknown>>;
  upsertQuestion: (input: Record<string, unknown>) => Promise<Res<{ id: string }>>;
  deleteQuestion: (questionId: string) => Promise<Res<unknown>>;
  generateTestPdf: (input: { version_id: string; sample_answers: Record<string, unknown> }) => Promise<Res<{ pdfBase64: string; gaps: Array<{ question_id: string; pdf_field_name: string }> }>>;
  publish: (input: { version_id: string; acknowledge_unmapped?: boolean }) => Promise<Res<{ ok: boolean; issues: Array<{ code: string; severity: "blocking" | "warning"; detail: string }> }>>;
  unpublish: (versionId: string) => Promise<Res<unknown>>;
  /** Duplicate an immutable version into a fresh editable draft (copies questions). */
  duplicateVersion: (versionId: string) => Promise<Res<{ id: string }>>;
  saveGenerationConfig: (input: Record<string, unknown>) => Promise<Res<unknown>>;
  testGeneration: (input: { form_definition_id: string; case_id: string; party_id?: string }) => Promise<Res<{ run_id: string }>>;
  /** Ensure (create if missing) an ai_letter's companion questionnaire; returns its id. */
  ensureCompanionQuestionnaire: (aiLetterFormId: string) => Promise<Res<{ id: string; slug: string; created: boolean }>>;
}

export const PDF_SOURCE_BASE = "/api/dev/catalog-pdf"; // replaced by signed URL in production
