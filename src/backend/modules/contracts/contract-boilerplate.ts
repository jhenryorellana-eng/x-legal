/**
 * Universal contract boilerplate (DOC-51).
 *
 * The clauses that are the SAME for every service — section titles, field
 * labels, and the standard legal blocks (included/excluded costs, nature of
 * service, client obligations, cancellation policy, acceptance). The legacy
 * jsPDF contract hard-coded these too; here they are localized constants so the
 * assembler (contract-document.ts) and renderers stay declarative.
 *
 * The VARIABLE parts (per-service object/scope/special clause, per-case parties,
 * plan + schedule, consultor data) are injected by buildContractDocument.
 *
 * Source of the Spanish wording: the production sample contract
 * (Contrato de Prestación de Servicios). English is the faithful translation.
 *
 * @module contracts/contract-boilerplate
 */

export type ContractLocale = "es" | "en";

export interface ContractBoilerplate {
  /** Document H1, e.g. "CONTRATO DE PRESTACIÓN DE SERVICIOS". */
  contractTitle: string;
  /** Ordered section headings keyed by their stable section key. */
  sectionTitles: {
    parties: string;
    object: string;
    scope: string;
    fees: string;
    schedule: string;
    costs: string;
    nature: string;
    obligations: string;
    cancellation: string;
    special: string;
    acceptance: string;
  };
  /** Sub-group headings within the "Parties" section. */
  partyGroups: {
    consultor: string;
    client: string;
    /** Heading for the committed additional parties (children/beneficiaries). */
    committed: string;
  };
  /** Field labels reused across the parties + fees sections. */
  labels: {
    company: string;
    representative: string;
    phone: string;
    zelle: string;
    fullName: string;
    passport: string;
    dateOfBirth: string;
    birthplace: string;
    address: string;
    cityStateZip: string;
    consultorRole: string;
    clientRole: string;
  };
  /** Payment-schedule table column headers + special rows. */
  schedule: {
    colInstallment: string;
    colDueDate: string;
    colAmount: string;
    downpaymentRow: string;
    installmentRow: string; // takes {n}
    totalRow: string;
  };
  /** Fee-clause sentence templates ({total},{downpayment},{balance},{count},{installment},{zelle}). */
  feeSentences: {
    total: string;
    installmentPlan: string;
    singlePayment: string;
    zelle: string;
  };
  /** Standard legal blocks (paragraphs / lists). */
  costsParagraphs: string[];
  natureParagraphs: string[];
  obligationsItems: string[];
  cancellationParagraphs: string[];
  acceptanceParagraph: string;
}

export const CONTRACT_BOILERPLATE: Record<ContractLocale, ContractBoilerplate> = {
  es: {
    contractTitle: "CONTRATO DE PRESTACIÓN DE SERVICIOS",
    sectionTitles: {
      parties: "PARTES DEL CONTRATO",
      object: "OBJETO DEL CONTRATO",
      scope: "ALCANCE DEL SERVICIO",
      fees: "HONORARIOS Y FORMA DE PAGO",
      schedule: "CRONOGRAMA DE PAGOS",
      costs: "GASTOS INCLUIDOS Y NO INCLUIDOS",
      nature: "NATURALEZA DEL SERVICIO",
      obligations: "OBLIGACIONES DEL CLIENTE",
      cancellation: "POLÍTICA DE CANCELACIÓN Y REEMBOLSO",
      special: "CLÁUSULA ESPECIAL",
      acceptance: "ACEPTACIÓN",
    },
    partyGroups: {
      consultor: "EL CONSULTOR",
      client: "EL CLIENTE",
      committed: "BENEFICIARIOS/AS",
    },
    labels: {
      company: "Empresa",
      representative: "Representante",
      phone: "Teléfono",
      zelle: "Zelle",
      fullName: "Nombre completo",
      passport: "Pasaporte",
      dateOfBirth: "Fecha de nacimiento",
      birthplace: "Lugar de nacimiento",
      address: "Dirección",
      cityStateZip: "Ciudad, estado, ZIP",
      consultorRole: "EL CONSULTOR",
      clientRole: "EL CLIENTE",
    },
    schedule: {
      colInstallment: "CUOTA",
      colDueDate: "FECHA DE PAGO",
      colAmount: "MONTO",
      downpaymentRow: "Cuota inicial",
      installmentRow: "Cuota {n}",
      totalRow: "TOTAL",
    },
    feeSentences: {
      total: "Los honorarios por los servicios descritos en este contrato ascienden a un total de {total}.",
      installmentPlan:
        "EL CLIENTE realizará un pago inicial de {downpayment} al momento de la firma del contrato, y el saldo restante de {balance} será pagadero en {count} cuotas mensuales de {installment} cada una.",
      singlePayment: "El pago se realizará en un único abono de {total} al momento de la firma del contrato.",
      zelle: "Método de pago Zelle: {zelle}.",
    },
    costsParagraphs: [
      "Los honorarios descritos incluyen todos los costos de traducción, certificación de documentos, envíos postales y demás gastos operativos relacionados con la preparación del caso. Dichos gastos son cubiertos en su totalidad por EL CONSULTOR como parte del servicio contratado.",
      "Los honorarios NO incluyen gastos gubernamentales (filing fees) que las agencias de gobierno requieran para procesar la solicitud. Dichos gastos serán responsabilidad del CLIENTE y se le informará oportunamente sobre los montos correspondientes.",
    ],
    natureParagraphs: [
      "EL CONSULTOR brinda servicios de asesoría y asistencia en la preparación de documentos y trámites migratorios. EL CONSULTOR no es abogado y no ofrece representación legal ante ninguna agencia gubernamental ni tribunal. Los resultados del proceso dependen de las autoridades competentes y no pueden ser garantizados.",
    ],
    obligationsItems: [
      "Proporcionar información veraz y completa para la preparación de su caso.",
      "Entregar la documentación solicitada en los plazos acordados.",
      "Realizar los pagos según el plan de cuotas establecido.",
      "Asistir puntualmente a todas las citas programadas.",
      "Informar al CONSULTOR de cualquier cambio en su situación personal o migratoria.",
    ],
    cancellationParagraphs: [
      "Una vez firmado el presente contrato, no se realizarán devoluciones de dinero por los servicios contratados. Los pagos realizados corresponden al inicio y avance del trabajo de preparación del caso, el cual comienza inmediatamente después de la firma.",
      "Si EL CLIENTE desea dar por terminado este contrato, deberá hacerlo únicamente por mutuo acuerdo con EL CONSULTOR. Para ello, EL CLIENTE enviará una carta escrita expresando su voluntad de terminar la relación contractual. EL CONSULTOR evaluará la solicitud y ambas partes acordarán los términos de la terminación.",
      "En ningún caso podrá EL CLIENTE dar por terminado el contrato de forma unilateral sin el consentimiento escrito de EL CONSULTOR.",
    ],
    acceptanceParagraph:
      "Ambas partes declaran haber leído y comprendido el contenido de este contrato, y lo aceptan en todas sus partes, firmando a continuación en señal de conformidad.",
  },
  en: {
    contractTitle: "SERVICES AGREEMENT",
    sectionTitles: {
      parties: "PARTIES TO THE AGREEMENT",
      object: "PURPOSE OF THE AGREEMENT",
      scope: "SCOPE OF SERVICE",
      fees: "FEES AND PAYMENT TERMS",
      schedule: "PAYMENT SCHEDULE",
      costs: "INCLUDED AND EXCLUDED COSTS",
      nature: "NATURE OF THE SERVICE",
      obligations: "CLIENT OBLIGATIONS",
      cancellation: "CANCELLATION AND REFUND POLICY",
      special: "SPECIAL CLAUSE",
      acceptance: "ACCEPTANCE",
    },
    partyGroups: {
      consultor: "THE CONSULTANT",
      client: "THE CLIENT",
      committed: "BENEFICIARIES",
    },
    labels: {
      company: "Company",
      representative: "Representative",
      phone: "Phone",
      zelle: "Zelle",
      fullName: "Full name",
      passport: "Passport",
      dateOfBirth: "Date of birth",
      birthplace: "Place of birth",
      address: "Address",
      cityStateZip: "City, state, ZIP",
      consultorRole: "THE CONSULTANT",
      clientRole: "THE CLIENT",
    },
    schedule: {
      colInstallment: "INSTALLMENT",
      colDueDate: "DUE DATE",
      colAmount: "AMOUNT",
      downpaymentRow: "Down payment",
      installmentRow: "Installment {n}",
      totalRow: "TOTAL",
    },
    feeSentences: {
      total: "The fees for the services described in this agreement amount to a total of {total}.",
      installmentPlan:
        "THE CLIENT will make an initial payment of {downpayment} upon signing the agreement, and the remaining balance of {balance} will be payable in {count} monthly installments of {installment} each.",
      singlePayment: "Payment will be made in a single amount of {total} upon signing the agreement.",
      zelle: "Zelle payment method: {zelle}.",
    },
    costsParagraphs: [
      "The fees described include all translation, document certification, postage and other operational costs related to the preparation of the case. Such costs are fully covered by THE CONSULTANT as part of the contracted service.",
      "The fees do NOT include government costs (filing fees) required by government agencies to process the application. Such costs are the responsibility of THE CLIENT and will be communicated in due course.",
    ],
    natureParagraphs: [
      "THE CONSULTANT provides advisory and assistance services in the preparation of documents and immigration procedures. THE CONSULTANT is not an attorney and does not offer legal representation before any government agency or court. The outcomes of the process depend on the competent authorities and cannot be guaranteed.",
    ],
    obligationsItems: [
      "Provide truthful and complete information for the preparation of your case.",
      "Submit the requested documentation within the agreed deadlines.",
      "Make payments according to the established installment plan.",
      "Attend all scheduled appointments punctually.",
      "Inform THE CONSULTANT of any change in your personal or immigration situation.",
    ],
    cancellationParagraphs: [
      "Once this agreement is signed, no refunds will be issued for the contracted services. The payments made correspond to the start and progress of the case preparation work, which begins immediately after signing.",
      "If THE CLIENT wishes to terminate this agreement, they must do so only by mutual agreement with THE CONSULTANT. To that end, THE CLIENT shall send a written letter expressing their intent to end the contractual relationship. THE CONSULTANT will evaluate the request and both parties will agree on the terms of termination.",
      "Under no circumstances may THE CLIENT terminate the agreement unilaterally without the written consent of THE CONSULTANT.",
    ],
    acceptanceParagraph:
      "Both parties declare that they have read and understood the content of this agreement and accept it in all its parts, signing below in agreement.",
  },
};
