import type { IconName } from "@/frontend/components/brand";

/**
 * Demo scenario model (admin-only marketing demo, DOC-21 frontend feature).
 *
 * A scenario is a fully self-contained, Spanish-language fixture that drives
 * BOTH demo walkthroughs ("Vista cliente" and "Vista staff") for one service.
 * It carries NO real data and never touches the backend — it is content
 * authored for a live demo (TikTok). New services light up a card simply by
 * adding a file to the registry (plus its `DEMO_ASSET_SLOTS` entry).
 *
 * Every scenario-specific string — including the staff micro-experience
 * titles, intros, loader headings and success splashes — lives HERE, not in
 * i18n: `staff.demo` keeps only chrome that is identical across scenarios
 * (buttons, tab names, generic templates). That is what makes a new demo a
 * one-file change.
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

/** Copy for the success splash a micro-experience shows when it finishes. */
export interface DemoSplashCopy {
  title: string;
  body: string;
}

/** One stat chip in a generation preview / printed page (values pre-formatted). */
export interface DemoStatChip {
  value: string;
  label: string;
}

/** One animated counter in the generation loader (AiCoreVisual). */
export interface DemoLoaderCounter {
  label: string;
  value: number;
}

/**
 * One field-mapping row for the automation assembly animation: a value flies
 * from the plain-language form the client filled into the official AcroForm
 * field of the government PDF.
 */
export interface DemoAutomationField {
  /** Plain-language label as the client saw it. */
  plain: string;
  /** Human-readable official field label. */
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

/** A grouped list of annex files (mirrors the scenario's document set). */
export interface DemoAnexoGroup {
  group: string;
  items: string[];
}

/** A labelled row on the expediente cover page (Solicitante, Servicio, …). */
export interface DemoCoverRow {
  label: string;
  value: string;
}

/** A row in the printed chronology table of the compiled expediente. */
export interface DemoChronologyRow {
  when: string;
  event: string;
}

/**
 * The "Automatización" micro-experience: the official-form (AcroForm) fill.
 * Asilo uses the I-589; Apelación the EOIR-26 — everything, including which
 * agency the kicker credits, comes from the fixture.
 */
export interface DemoAutomationFixture {
  /** `DEMO_ASSET_SLOTS` key whose uploaded PDF this tab reveals when done. */
  slotKey: string;
  /** Row/reader title, e.g. "Formulario I-589". */
  title: string;
  /** Long official name shown under the title and on the printed page. */
  officialTitle: string;
  /** TabIntro line explaining what the automation does. */
  intro: string;
  /** Heading of the assembly loader overlay. */
  loaderTitle: string;
  /** Left panel label in the assembly animation (the client's plain form). */
  sourcePanelLabel: string;
  /** Right panel label in the assembly animation (the official PDF). */
  targetPanelLabel: string;
  /** Chip shown while empty fields are auto-filled, e.g. "34 campos vacíos → N/A". */
  filledChipLabel: string;
  /** Legal note about auto-filled fields (plain text, citation included). */
  fillNote: string;
  /** Heading of the HTML preview (simulation fallback). */
  previewTitle: string;
  /** Done-state meta line, e.g. "12 págs · PDF oficial · 34 campos en N/A". */
  doneMeta: string;
  /** Kicker on the printed expediente page, e.g. "Formulario oficial · USCIS". */
  docKicker: string;
  /** Title on the printed expediente page, e.g. "Formulario I-589 — Parte A". */
  docPageTitle: string;
  /** Filename for the real-PDF download, e.g. "i-589.pdf". */
  downloadName: string;
  splash: DemoSplashCopy;
  fields: DemoAutomationField[];
  steps: DemoLoaderStep[];
}

/**
 * The "Generaciones" micro-experience: the long-form AI letter (ai_letter).
 * Asilo generates the credible-fear memo; Apelación the BIA appeal brief.
 */
export interface DemoGenerationFixture {
  /** `DEMO_ASSET_SLOTS` key whose uploaded PDF this tab reveals when done. */
  slotKey: string;
  /** Row/reader title, e.g. "Memorándum de Miedo Creíble". */
  title: string;
  /** Short descriptor under the title. */
  caption: string;
  /** TabIntro line explaining what the AI drafts. */
  intro: string;
  /** Heading of the generation loader overlay. */
  loaderTitle: string;
  /** Heading of the HTML preview (simulation fallback). */
  previewTitle: string;
  /** One-paragraph excerpt shown in the preview. */
  snippet: string;
  /** Longer narrative paragraph on the printed expediente page. */
  longSummary: string;
  /** Heading of the section index, e.g. "Índice del memorándum". */
  indexTitle: string;
  /** Kicker on the printed expediente page, e.g. "Generado con IA · Verificado". */
  docKicker: string;
  /** Done-state meta line, e.g. "69,103 palabras · 251 páginas · listo". */
  doneMeta: string;
  /** Filename for the real-PDF download, e.g. "memorandum.pdf". */
  downloadName: string;
  splash: DemoSplashCopy;
  /** Section index shown in the preview and the printed page. */
  sections: string[];
  /** Stat chips in the preview and the printed page (pre-formatted values). */
  stats: DemoStatChip[];
  /** Animated counters in the loader (AiCoreVisual). */
  loaderCounters: DemoLoaderCounter[];
  steps: DemoLoaderStep[];
}

/**
 * A client-filed official document annexed into the compiled expediente. Used
 * when the scenario does NOT generate the official form itself (no `automation`
 * micro-experience) — e.g. Reforzar Asilo, where the applicant already filed
 * her I-589 with USCIS and it is annexed as-is, not re-generated.
 */
export interface DemoExpedienteFiledDoc {
  /** Kicker on the printed page, e.g. "Documento del cliente · Anexo". */
  docKicker: string;
  /** Title on the printed page, e.g. "I-589 presentado (completo)". */
  docPageTitle: string;
  /** Long official name shown under the title. */
  officialTitle: string;
  /** Labelled rows extracted from the filed document (Solicitante, Nº recibo, …). */
  rows: DemoCoverRow[];
  /** Plain-text note under the rows (e.g. that this is the client's own filing). */
  note: string;
}

/** The "Expediente" micro-experience: the compiled, printable legal file. */
export interface DemoExpedienteFixture {
  /** `DEMO_ASSET_SLOTS` key whose uploaded PDF this tab reveals when done. */
  slotKey: string;
  /** Row/reader title, e.g. "Expediente legal". */
  title: string;
  /** Short descriptor under the title. */
  caption: string;
  /** TabIntro line explaining what gets compiled. */
  intro: string;
  /** Heading of the compile loader overlay. */
  loaderTitle: string;
  /** Reader toolbar note, e.g. "Expediente compilado y listo para revisión legal." */
  toolbarNote: string;
  /** Filename for the real-PDF download, e.g. "expediente.pdf". */
  downloadName: string;
  splash: DemoSplashCopy;
  coverTitle: string;
  coverSubtitle: string;
  /** Labelled rows on the cover page (Solicitante, Servicio, Plan, …). */
  coverRows: DemoCoverRow[];
  toc: DemoTocEntry[];
  anexos: DemoAnexoGroup[];
  /** Chronology table printed as the closing page. */
  chronology: DemoChronologyRow[];
  /**
   * Page numbers stamped on the representative printed pages (must agree with
   * `toc`): the official form, the AI generation, the annex index and the
   * chronology table.
   */
  samplePages: { form: number; generation: number; anexos: number; chronology: number };
  totalPages: number;
  steps: DemoLoaderStep[];
  /**
   * Content for the representative "official form" page (`samplePages.form`) when
   * the scenario has no `automation` micro-experience: the client's already-filed
   * document, annexed. When both `automation` and `filedDoc` are absent, the page
   * is omitted.
   */
  filedDoc?: DemoExpedienteFiledDoc;
}

/**
 * Everything the "Vista staff" needs — case metadata, key facts, timeline, and
 * the fixtures behind the four AI micro-experiences (translate, official-form
 * automation, AI generation, expediente). Pure content: no PII, no backend.
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
  /**
   * The official-form automation. Optional: a scenario that does not generate an
   * official form (e.g. Reforzar Asilo — the I-589 was already filed by the
   * client) omits it, and the "Automatización" tab is not shown for that demo.
   */
  automation?: DemoAutomationFixture;
  generation: DemoGenerationFixture;
  expediente: DemoExpedienteFixture;
}
