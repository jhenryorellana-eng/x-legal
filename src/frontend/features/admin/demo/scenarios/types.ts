import type { IconName } from "@/frontend/components/brand";

/**
 * Demo scenario model (admin-only marketing demo, DOC-21 frontend feature).
 *
 * A scenario is a fully self-contained, Spanish-language fixture that drives the
 * client-side "Vista cliente" walkthrough for one service. It carries NO real
 * data and never touches the backend — it is content authored for a live demo
 * (TikTok), combining phase-1 and phase-2 artifacts into a single simplified
 * flow. New services light up a card simply by adding a file to the registry.
 */

export type PartyRole = "applicant" | "dependent" | "spouse";

export interface DemoParty {
  name: string;
  role: PartyRole;
}

export interface DemoInstallment {
  /** Display label, e.g. "Cuota inicial" or "Cuota 2". */
  label: string;
  amount: string; // "$500"
  /** Short due-date label, e.g. "Hoy" / "5 ago". */
  due: string;
  /** The first (down) payment the demo "pays" in the Pagos stage. */
  isDownPayment?: boolean;
}

export interface DemoContractClause {
  title: string;
  body: string;
}

export interface DemoContract {
  planLabel: string; // "Asilo Político · Con abogado"
  /** Headline amount shown on the Pagos navy card ("Próxima cuota"). */
  nextAmount: string; // "$500"
  installments: DemoInstallment[];
  clauses: DemoContractClause[];
}

export interface DemoDocItem {
  id: string;
  /** Combined label, e.g. "Pasaportes de Karelis, Alexander, Kamila y Amanda". */
  label: string;
  /** Optional helper line under the label. */
  hint?: string;
  /** Accordion group, e.g. "Identidad". */
  category: string;
  /**
   * Key data the staff "Traducir" flow reveals as the AI extracts the document
   * (Gemini extraction preview). Content only — never fetched.
   */
  extract?: DemoDocExtract[];
}

/** A single extracted key/value pair surfaced while "translating" a document. */
export interface DemoDocExtract {
  field: string;
  value: string;
}

export interface DemoFormQA {
  q: string;
  a: string;
}

export interface DemoFormSection {
  title: string;
  items: DemoFormQA[];
}

export interface DemoForm {
  id: string;
  label: string; // "Formulario I-589"
  /** "pdf" (AcroForm automation) or "letter" (AI-generated memo). */
  kind: "pdf" | "letter";
  /** Always 100 in the demo; explicit for the progress chip/ring. */
  progress: number;
  /** Short descriptor under the title. */
  caption: string;
  sections: DemoFormSection[];
}

/** Didactic narration shown under the phone for each stage of the flow. */
export interface DemoCaptions {
  cases: string;
  signing: string;
  pagos: string;
  disclaimer: string;
  documentos: string;
  formularios: string;
  review: string;
}

export interface DemoScenario {
  slug: string;
  /** Fallback service card visuals when the catalog has no slug match. */
  service: { label: string; icon: IconName; color: string };
  client: {
    firstName: string;
    parties: DemoParty[];
  };
  /** Case title shown in cards/headers, e.g. "Asilo Político — Karelis". */
  caseTitle: string;
  /** "Fase 1 de 2 · Preparación" — already localized. */
  phaseLabel: string;
  contract: DemoContract;
  documents: DemoDocItem[];
  forms: DemoForm[];
  captions: DemoCaptions;
  /** Content that drives the "Vista staff" walkthrough (staff panel of the case). */
  staff: DemoStaffFixture;
}

/** One narration step shown in a staff sequence loader (AI processing). */
export interface DemoLoaderStep {
  icon: IconName;
  text: string;
}

/**
 * One field-mapping row for the I-589 assembly animation: a value flies from the
 * plain-language form the client filled into the official USCIS AcroForm field.
 */
export interface DemoStaffI589Field {
  /** Plain-language label as the client saw it. */
  plain: string;
  /** Human-readable official USCIS field label. */
  official: string;
  /** Real AcroForm field name (e.g. "PtAILine4_LastName") — shown as a mono tag. */
  fieldName: string;
  /** Value that flies into the official form; `null` → auto-filled with "N/A". */
  value: string | null;
}

/** Table-of-contents entry for the compiled expediente. */
export interface DemoTocEntry {
  title: string;
  page: number;
}

/** A grouped list of annex files (mirrors the real Karelis document set). */
export interface DemoAnexoGroup {
  group: string;
  items: string[];
}

/**
 * Everything the "Vista staff" needs — case metadata, key facts, timeline, and
 * the fixtures behind the four AI micro-experiences (translate, I-589 assembly,
 * credible-fear memo, expediente). Pure content: no PII, no backend.
 */
export interface DemoStaffFixture {
  caseNumber: string;
  clientLegalName: string;
  clientPhone: string;
  planLabel: string;
  statusLabel: string;
  owner: { name: string; role: string };
  /** Key facts grid in the Resumen tab. */
  keyFacts: { label: string; value: string }[];
  /** Recent case history (timeline) in the Resumen tab. */
  timeline: { icon: IconName; title: string; when: string }[];
  docsApproved: number;
  docsTotal: number;
  formsDone: number;
  formsTotal: number;
  /** Translate-flow narration, shared by every document row. */
  translateSteps: DemoLoaderStep[];
  i589: {
    officialTitle: string;
    fields: DemoStaffI589Field[];
    naCount: number;
    pageCount: number;
    steps: DemoLoaderStep[];
  };
  memo: {
    steps: DemoLoaderStep[];
    wordCount: number;
    pageCount: number;
    exhibits: number;
    sources: number;
    /** Section index shown in the success preview. */
    sections: string[];
  };
  expediente: {
    steps: DemoLoaderStep[];
    coverTitle: string;
    coverSubtitle: string;
    toc: DemoTocEntry[];
    anexos: DemoAnexoGroup[];
    totalPages: number;
  };
}
