/**
 * Taxonomy of asylum denial reasons (Etapa D — Pre-Mortem).
 *
 * The 11 canonical grounds an immigration judge / asylum officer most commonly
 * relies on to DENY an asylum claim (INA §208, 8 CFR §1208, BIA precedent).
 * Used in two places:
 *   1. As dataset tags on `ai_dataset_items` (why a precedent was won/lost), to
 *      steer semantic retrieval toward the relevant failure mode.
 *   2. As the closed enum the Pre-Mortem AI critic must map each predicted risk
 *      to (so the output is structured + actionable, not free prose).
 *
 * Codes are stable identifiers (DB + AI contract); labels/help are bilingual for
 * the staff UI. NOT legal advice — a heuristic to surface weaknesses pre-filing.
 */

export const DENIAL_REASON_CODES = [
  "NEXUS_FAIL",
  "IMPUTED_WEAK",
  "CREDIBILITY",
  "CORROBORATION",
  "NOT_PERSECUTION",
  "WFF_OBJECTIVE",
  "RELOCATION",
  "STATE_ACTION",
  "ONE_YEAR_BAR",
  "ACA_BAR",
  "MANDATORY_BAR",
] as const;

export type DenialReasonCode = (typeof DENIAL_REASON_CODES)[number];

export interface DenialReasonMeta {
  code: DenialReasonCode;
  label: { es: string; en: string };
  /** Short staff-facing explanation of the failure mode (what to shore up). */
  help: { es: string; en: string };
}

export const DENIAL_REASONS: Record<DenialReasonCode, DenialReasonMeta> = {
  NEXUS_FAIL: {
    code: "NEXUS_FAIL",
    label: { es: "Falta de nexo", en: "Nexus failure" },
    help: {
      es: "No se probó que la persecución sea 'por causa de' un motivo protegido (raza, religión, nacionalidad, opinión política o grupo social).",
      en: "Failed to show the persecution was 'on account of' a protected ground (race, religion, nationality, political opinion, or particular social group).",
    },
  },
  IMPUTED_WEAK: {
    code: "IMPUTED_WEAK",
    label: { es: "Opinión imputada débil", en: "Weak imputed opinion" },
    help: {
      es: "La opinión política (o pertenencia) imputada por el agente persecutor no quedó suficientemente demostrada.",
      en: "The political opinion (or membership) imputed by the persecutor was not sufficiently established.",
    },
  },
  CREDIBILITY: {
    code: "CREDIBILITY",
    label: { es: "Credibilidad", en: "Credibility" },
    help: {
      es: "Inconsistencias, omisiones o falta de detalle/plausibilidad debilitan la declaración del solicitante.",
      en: "Inconsistencies, omissions, or lack of detail/plausibility undermine the applicant's testimony.",
    },
  },
  CORROBORATION: {
    code: "CORROBORATION",
    label: { es: "Falta de corroboración", en: "Lack of corroboration" },
    help: {
      es: "Faltan pruebas razonablemente disponibles que respalden los hechos (documentos, declaraciones, evidencia médica/policial).",
      en: "Missing reasonably available evidence to corroborate the facts (documents, affidavits, medical/police evidence).",
    },
  },
  NOT_PERSECUTION: {
    code: "NOT_PERSECUTION",
    label: { es: "No alcanza persecución", en: "Harm below persecution" },
    help: {
      es: "El daño descrito no llega al umbral de 'persecución' (molestias/discriminación aislada, sin gravedad acumulada).",
      en: "The described harm does not rise to the 'persecution' threshold (isolated harassment/discrimination, no cumulative severity).",
    },
  },
  WFF_OBJECTIVE: {
    code: "WFF_OBJECTIVE",
    label: { es: "Temor no objetivamente fundado", en: "Fear not objectively well-founded" },
    help: {
      es: "El temor a futura persecución no es objetivamente razonable a la luz de las condiciones del país.",
      en: "The fear of future persecution is not objectively reasonable in light of country conditions.",
    },
  },
  RELOCATION: {
    code: "RELOCATION",
    label: { es: "Reubicación interna", en: "Internal relocation" },
    help: {
      es: "El solicitante podría reubicarse de forma segura y razonable dentro de su país, evitando la persecución.",
      en: "The applicant could safely and reasonably relocate within their country to avoid persecution.",
    },
  },
  STATE_ACTION: {
    code: "STATE_ACTION",
    label: { es: "Agente no estatal / control", en: "Non-state actor / control" },
    help: {
      es: "Si el persecutor es privado, no se probó que el gobierno no pueda o no quiera controlarlo.",
      en: "Where the persecutor is private, failed to show the government is unable or unwilling to control them.",
    },
  },
  ONE_YEAR_BAR: {
    code: "ONE_YEAR_BAR",
    label: { es: "Plazo de un año", en: "One-year filing bar" },
    help: {
      es: "La solicitud se presentó pasado un año de la última entrada sin una excepción (circunstancias cambiantes/extraordinarias) acreditada.",
      en: "Filed more than one year after last entry without an established exception (changed/extraordinary circumstances).",
    },
  },
  ACA_BAR: {
    code: "ACA_BAR",
    label: { es: "Tercer país seguro", en: "Safe third country / ACA" },
    help: {
      es: "Aplica un acuerdo de cooperación de asilo / tercer país seguro que veda la elegibilidad.",
      en: "A safe-third-country / asylum cooperative agreement bars eligibility.",
    },
  },
  MANDATORY_BAR: {
    code: "MANDATORY_BAR",
    label: { es: "Barra obligatoria", en: "Mandatory bar" },
    help: {
      es: "Aplica una barra obligatoria (perseguidor, delito grave, reasentamiento firme, terrorismo, etc.).",
      en: "A mandatory bar applies (persecutor, serious crime, firm resettlement, terrorism, etc.).",
    },
  },
};

/** Type guard for AI output validation (the critic must return a known code). */
export function isDenialReasonCode(v: unknown): v is DenialReasonCode {
  return typeof v === "string" && (DENIAL_REASON_CODES as readonly string[]).includes(v);
}
