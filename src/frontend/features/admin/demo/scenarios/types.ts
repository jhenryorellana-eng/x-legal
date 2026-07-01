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
}
