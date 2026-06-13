/**
 * Canonical contract notice text (DOC-51 §12 / §27).
 *
 * The 5 sections rendered in the scrollable contract box. In production the full
 * body comes from the active terms_versions referenced by contracts.terms_version
 * (org-scoped, no anonymous RLS read yet). Until a public-safe terms read exists,
 * we render the canonical seed text from the SoT. The structured summary (service,
 * plan, parties, payment plan) is shown separately in the summary card.
 *
 * TODO(F-terms): replace with the joined terms_versions.body_md_i18n body.
 */

export interface ContractSection {
  title: string;
  body: string;
}

export const CONTRACT_SECTIONS: Record<"es" | "en", ContractSection[]> = {
  es: [
    {
      title: "1. Objeto del servicio",
      body: "UsaLatinoPrime te acompaña en la preparación y presentación de tu trámite. No garantizamos un resultado específico, ya que la decisión final corresponde a las autoridades (USCIS, cortes y otras entidades).",
    },
    {
      title: "2. Honorarios y plan de pagos",
      body: "Los honorarios y el plan de pagos son los detallados en el resumen de este contrato. Las tarifas oficiales del gobierno no son reembolsables una vez presentadas.",
    },
    {
      title: "3. Obligaciones de las partes",
      body: "Te comprometes a entregar información y documentos verdaderos y completos. Proporcionar datos falsos puede afectar gravemente tu caso y es tu responsabilidad.",
    },
    {
      title: "4. Protección de datos",
      body: "Tu información se almacena de forma segura y solo la usamos para gestionar tu caso. No la compartimos con terceros salvo cuando el trámite lo exige ante la autoridad correspondiente.",
    },
    {
      title: "5. Vigencia y firma",
      body: "Al firmar este contrato confirmas que lo leíste y estás de acuerdo con estas condiciones para celebrarlo. Los tiempos de respuesta de las autoridades están fuera de nuestro control.",
    },
  ],
  en: [
    {
      title: "1. Scope of service",
      body: "UsaLatinoPrime assists you with the preparation and filing of your case. We do not guarantee a specific outcome, as the final decision belongs to the authorities (USCIS, courts and other entities).",
    },
    {
      title: "2. Fees and payment plan",
      body: "The fees and payment plan are those detailed in this contract's summary. Official government fees are non-refundable once filed.",
    },
    {
      title: "3. Obligations of the parties",
      body: "You commit to providing truthful and complete information and documents. Providing false data can seriously affect your case and is your responsibility.",
    },
    {
      title: "4. Data protection",
      body: "Your information is stored securely and used only to manage your case. We do not share it with third parties except when the process requires it before the relevant authority.",
    },
    {
      title: "5. Term and signature",
      body: "By signing this contract you confirm that you have read it and agree to these conditions to execute it. The authorities' response times are outside our control.",
    },
  ],
};
