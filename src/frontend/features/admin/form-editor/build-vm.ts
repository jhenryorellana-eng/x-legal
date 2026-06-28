import type {
  FormEditorVM,
  QuestionGroupVM,
  QuestionVM,
  VersionVM,
  QuestionSource,
  FieldType,
} from "./types";
import type { I18nValue } from "../shared/i18n-field";
import { parseConditionOrNull } from "@/shared/form-logic/conditions";

/**
 * buildFormEditorVM — pure mapper from the catalog module-pub FormEditorData
 * read into the editor view-model. Runs server-side in the RSC page; takes the
 * structurally-typed read (no @/backend import in the type signature) so the
 * feature stays boundary-clean.
 */

interface RawI18n {
  es?: string;
  en?: string;
}
function i18n(v: unknown): I18nValue {
  const o = (v ?? {}) as RawI18n;
  return { es: o.es ?? "", en: o.en ?? "" };
}

export interface RawFormEditorData {
  form: { id: string; slug: string; kind: string; label_i18n: RawI18n; service_phase_id: string };
  service: { id: string; slug: string; label_i18n: RawI18n };
  versions: Array<{ id: string; version: number; status: string; detected_fields: unknown[]; source_pdf_path: string; published_at: string | null }>;
  openVersion: {
    version: { id: string; version: number; status: string; detected_fields: unknown[]; source_pdf_path: string; published_at: string | null };
    groups: Array<{
      id: string;
      automation_version_id: string;
      title_i18n: RawI18n;
      position: number;
      questions: Array<Record<string, unknown>>;
    }>;
  } | null;
  sources: { documents: Array<{ slug: string; paths?: string[] }>; forms: string[]; profileFields: string[] };
  generationConfig: Record<string, unknown> | null;
}

export interface RawDataset {
  id: string;
  name: string;
  total_tokens: number;
  is_active: boolean;
}

export function buildFormEditorVM(data: RawFormEditorData, datasets: RawDataset[]): FormEditorVM {
  const toVersion = (v: RawFormEditorData["versions"][number]): VersionVM => ({
    id: v.id,
    version: v.version,
    status: (v.status as VersionVM["status"]) ?? "draft",
    detected_fields: (v.detected_fields ?? []) as VersionVM["detected_fields"],
    source_pdf_path: v.source_pdf_path,
    published_at: v.published_at,
  });

  const toQuestion = (q: Record<string, unknown>): QuestionVM => ({
    id: q.id as string,
    group_id: q.group_id as string,
    question_i18n: i18n(q.question_i18n),
    help_i18n: i18n(q.help_i18n),
    field_type: (q.field_type as FieldType) ?? "text",
    options: (q.options as QuestionVM["options"]) ?? null,
    pdf_field_name: (q.pdf_field_name as string | null) ?? null,
    source: (q.source as QuestionSource) ?? "client_answer",
    source_ref: (q.source_ref as Record<string, unknown> | null) ?? null,
    is_required: (q.is_required as boolean) ?? true,
    position: (q.position as number) ?? 0,
    validation: (q.validation as Record<string, unknown> | null) ?? null,
    condition: parseConditionOrNull(q.condition),
  });

  const groups: QuestionGroupVM[] = (data.openVersion?.groups ?? []).map((g) => ({
    id: g.id,
    automation_version_id: g.automation_version_id,
    title_i18n: i18n(g.title_i18n),
    position: g.position,
    questions: (g.questions ?? []).map(toQuestion).sort((a, b) => a.position - b.position),
  }));

  const cfg = data.generationConfig;

  return {
    form: {
      id: data.form.id,
      slug: data.form.slug,
      kind: (data.form.kind as "pdf_automation" | "ai_letter") ?? "pdf_automation",
      label: i18n(data.form.label_i18n),
      serviceLabel: i18n(data.service.label_i18n),
    },
    service: { id: data.service.id, slug: data.service.slug },
    versions: data.versions.map(toVersion),
    openVersion: data.openVersion
      ? { version: toVersion(data.openVersion.version), groups }
      : null,
    sources: {
      documents: data.sources.documents.map((d) => ({ slug: d.slug, paths: d.paths ?? [] })),
      forms: data.sources.forms,
      profileFields: data.sources.profileFields,
    },
    generationConfig: cfg
      ? {
          system_prompt: (cfg.system_prompt as string) ?? "",
          input_document_slugs: (cfg.input_document_slugs as string[]) ?? [],
          input_form_slugs: (cfg.input_form_slugs as string[]) ?? [],
          dataset_id: (cfg.dataset_id as string | null) ?? null,
          model: (cfg.model as string) ?? "claude-sonnet-4-6",
          max_output_tokens: (cfg.max_output_tokens as number) ?? 32000,
          output_format: (cfg.output_format as "pdf" | "docx" | "md") ?? "pdf",
          output_language: (cfg.output_language as "es" | "en" | "both") ?? "en",
          web_search_enabled: (cfg.web_search_enabled as boolean) ?? false,
          web_search_max_uses: (cfg.web_search_max_uses as number) ?? 5,
          research_instructions: (cfg.research_instructions as string | null) ?? null,
          research_model: (cfg.research_model as string | null) ?? null,
          sections: (cfg.sections as import("./types").GenerationSectionVM[]) ?? [],
          rules_enabled: (cfg.rules_enabled as boolean) ?? true,
          rules_text: (cfg.rules_text as string | null) ?? null,
          assembly: (cfg.assembly as import("./types").GenerationAssemblyVM | null) ?? null,
        }
      : null,
    datasets: datasets.map((d) => ({ id: d.id, name: d.name, tokens: d.total_tokens, active: d.is_active })),
  };
}
