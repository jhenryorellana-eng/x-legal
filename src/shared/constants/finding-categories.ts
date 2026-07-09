/**
 * Taxonomy for the Pre-Mortem quality validator (reorientation of Etapa D).
 *
 * The Pre-Mortem no longer predicts asylum denial *grounds* (see denial-reasons.ts,
 * still used as dataset tags). It now VALIDATES a concrete generated artifact — an
 * AI letter (`ai_letter`) or an autofilled official form (`pdf_automation`, e.g.
 * USCIS I-589) — against an admin-uploaded filling guide (rubric) + the case
 * context + web examples, and returns a structured quality report:
 *   { score 0-100, semaforo, verdict, summary, findings[] }.
 *
 * Codes are stable identifiers shared across three layers (must match the CHECK
 * constraints of migration 0077 and the AI JSON contract exactly):
 *   - DB: case_pre_mortem_assessments.{semaforo, verdict} + findings[].{severity, category}
 *   - AI: the closed enums the validator must emit
 *   - UI: bilingual labels for the staff report
 *
 * NOT legal advice — a heuristic QA gate to catch errors/discordances/bad filling
 * BEFORE a document is filed with USCIS/EOIR.
 */

/* -------------------------------------------------------------------------- */
/* Severities                                                                 */
/* -------------------------------------------------------------------------- */

export const FINDING_SEVERITIES = ["critico", "moderado", "sugerencia"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface FindingSeverityMeta {
  severity: FindingSeverity;
  label: { es: string; en: string };
  /** Ranking used to sort findings (lower = more severe, shown first). */
  rank: number;
}

export const FINDING_SEVERITY_META: Record<FindingSeverity, FindingSeverityMeta> = {
  critico: { severity: "critico", label: { es: "Crítico", en: "Critical" }, rank: 0 },
  moderado: { severity: "moderado", label: { es: "Moderado", en: "Moderate" }, rank: 1 },
  sugerencia: { severity: "sugerencia", label: { es: "Sugerencia", en: "Suggestion" }, rank: 2 },
};

/* -------------------------------------------------------------------------- */
/* Finding categories                                                         */
/* -------------------------------------------------------------------------- */

export const FINDING_CATEGORIES = [
  "mal_llenado",
  "discordancia",
  "formato",
  "placeholder_sin_resolver",
  "campo_faltante",
  "dato_incoherente",
  "calidad",
] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export interface FindingCategoryMeta {
  category: FindingCategory;
  label: { es: string; en: string };
  /** Short staff-facing explanation of the failure mode. */
  help: { es: string; en: string };
}

export const FINDING_CATEGORIES_META: Record<FindingCategory, FindingCategoryMeta> = {
  mal_llenado: {
    category: "mal_llenado",
    label: { es: "Mal llenado", en: "Bad filling" },
    help: {
      es: "Un campo se llenó con un valor incorrecto según la guía (formato, idioma, N/A vs None vs vacío, checkbox mal marcado).",
      en: "A field was filled with a value that violates the guide (format, language, N/A vs None vs blank, wrong checkbox).",
    },
  },
  discordancia: {
    category: "discordancia",
    label: { es: "Discordancia", en: "Discrepancy" },
    help: {
      es: "Un dato del documento no coincide con la fuente (documento subido, declaración, u otro campo del formulario).",
      en: "A value in the document does not match its source (uploaded document, statement, or another form field).",
    },
  },
  formato: {
    category: "formato",
    label: { es: "Formato", en: "Formatting" },
    help: {
      es: "Problema de formato: fecha mal formateada, dirección no parseada, mayúsculas/estructura, o render defectuoso.",
      en: "Formatting issue: malformed date, unparsed address, casing/structure, or broken rendering.",
    },
  },
  placeholder_sin_resolver: {
    category: "placeholder_sin_resolver",
    label: { es: "Placeholder sin resolver", en: "Unresolved placeholder" },
    help: {
      es: "El documento contiene un marcador sin reemplazar («…», [NOMBRE], {{token}}) que no debe llegar al envío.",
      en: "The document contains an unreplaced placeholder («…», [NAME], {{token}}) that must not reach filing.",
    },
  },
  campo_faltante: {
    category: "campo_faltante",
    label: { es: "Campo faltante", en: "Missing field" },
    help: {
      es: "Un campo requerido quedó vacío o una sección obligatoria falta según la guía.",
      en: "A required field is empty or a mandatory section is missing per the guide.",
    },
  },
  dato_incoherente: {
    category: "dato_incoherente",
    label: { es: "Dato incoherente", en: "Inconsistent data" },
    help: {
      es: "Incoherencia lógica interna (sexo↔narrativa, DOB repetido/distinto, estado civil vs sección de cónyuge, lógica CAT).",
      en: "Internal logical inconsistency (sex↔narrative, duplicated/mismatched DOB, marital status vs spouse section, CAT logic).",
    },
  },
  calidad: {
    category: "calidad",
    label: { es: "Calidad", en: "Quality" },
    help: {
      es: "Debilidad de calidad frente a ejemplos oficiales: redacción, exhaustividad, o solidez que reduce la probabilidad de aprobación.",
      en: "Quality weakness vs official examples: drafting, completeness, or strength that lowers the approval likelihood.",
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Semáforo + verdict                                                         */
/* -------------------------------------------------------------------------- */

export const SEMAFORO_VALUES = ["green", "amber", "red"] as const;
export type Semaforo = (typeof SEMAFORO_VALUES)[number];

export const VERDICT_VALUES = ["would_approve", "needs_corrections", "would_reject"] as const;
export type Verdict = (typeof VERDICT_VALUES)[number];

export const VERDICT_META: Record<Verdict, { label: { es: string; en: string }; approved: boolean }> = {
  would_approve: { label: { es: "Se aprobaría", en: "Would be approved" }, approved: true },
  needs_corrections: { label: { es: "Necesita correcciones", en: "Needs corrections" }, approved: false },
  would_reject: { label: { es: "Sería rechazado", en: "Would be rejected" }, approved: false },
};

/* -------------------------------------------------------------------------- */
/* Type guards (AI output validation — the validator must emit known values)  */
/* -------------------------------------------------------------------------- */

export function isFindingSeverity(v: unknown): v is FindingSeverity {
  return typeof v === "string" && (FINDING_SEVERITIES as readonly string[]).includes(v);
}

export function isFindingCategory(v: unknown): v is FindingCategory {
  return typeof v === "string" && (FINDING_CATEGORIES as readonly string[]).includes(v);
}

export function isSemaforo(v: unknown): v is Semaforo {
  return typeof v === "string" && (SEMAFORO_VALUES as readonly string[]).includes(v);
}

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICT_VALUES as readonly string[]).includes(v);
}

/** Sort comparator for findings: most severe first. */
export function compareFindingSeverity(a: FindingSeverity, b: FindingSeverity): number {
  return FINDING_SEVERITY_META[a].rank - FINDING_SEVERITY_META[b].rank;
}

/** Derive a semáforo from a 0-100 score (fallback when the model omits it). */
export function semaforoFromScore(score: number): Semaforo {
  if (score >= 80) return "green";
  if (score >= 50) return "amber";
  return "red";
}
