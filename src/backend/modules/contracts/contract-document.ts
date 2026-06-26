/**
 * Contract document assembler (DOC-51) — PURE.
 *
 * buildContractDocument() turns the contract's structured inputs (consultor org
 * data, per-service content, plan + schedule, and the ALREADY-FILTERED committed
 * parties) into a neutral, ordered ContractDocument. Both the public signing page
 * (HTML) and the PDF renderer consume this same structure, so the contract reads
 * identically on screen and on paper.
 *
 * No IO, no framework imports. Deterministic: the contract date is passed in as
 * an ISO string (never read from the clock) so the document is reproducible.
 *
 * @module contracts/contract-document
 */

import {
  CONTRACT_BOILERPLATE,
  type ContractBoilerplate,
  type ContractLocale,
} from "./contract-boilerplate";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ContractConsultorInput {
  companyName: string;
  representativeName?: string | null;
  phone?: string | null;
  zelleEmail?: string | null;
}

export interface ContractClientInput {
  name: string | null;
  passport?: string | null;
  dateOfBirth?: string | null; // ISO yyyy-mm-dd
  addressLine1?: string | null;
  cityStateZip?: string | null;
}

/** A committed (contract) party other than the principal client. Already filtered. */
export interface ContractPartyInput {
  roleLabel: string;
  name: string;
  dateOfBirth?: string | null; // ISO yyyy-mm-dd
  birthplace?: string | null;
  passport?: string | null;
}

export interface ContractScheduleRow {
  number: number;
  amountCents: number;
  dueDate?: string | null; // ISO yyyy-mm-dd
  isDownpayment?: boolean;
}

export interface ContractDocumentInput {
  locale: ContractLocale;
  /** Contract date as ISO yyyy-mm-dd (passed in — pure, no clock read). */
  dateIso: string;
  consultor: ContractConsultorInput;
  serviceLabel: string;
  client: ContractClientInput;
  /** Additional parties committed in the contract (already filtered by role). */
  committedParties: ContractPartyInput[];
  objeto?: string | null;
  alcance?: string[] | null;
  especial?: string | null;
  fees: {
    totalCents: number;
    downpaymentCents?: number | null;
    installmentCount?: number | null;
    currency: string;
  };
  schedule: ContractScheduleRow[];
}

// ---------------------------------------------------------------------------
// Output (neutral, renderer-agnostic)
// ---------------------------------------------------------------------------

export type ContractBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "fieldGroup"; heading: string; rows: Array<{ label: string; value: string }> }
  | {
      kind: "scheduleTable";
      headers: [string, string, string];
      rows: Array<{ cells: [string, string, string]; emphasis?: boolean }>;
    };

export interface ContractSection {
  key: string;
  title: string;
  blocks: ContractBlock[];
}

export interface ContractDocument {
  title: string;
  subtitle: string;
  dateLabel: string;
  sections: ContractSection[];
  signatures: {
    consultor: { name: string; role: string };
    client: { name: string; role: string };
  };
}

// ---------------------------------------------------------------------------
// Pure formatting helpers
// ---------------------------------------------------------------------------

const MONTHS: Record<ContractLocale, string[]> = {
  es: [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ],
  en: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
};

/** Formats an ISO yyyy-mm-dd date as a long, localized date. Returns "" for empty/invalid. */
export function formatContractDate(iso: string | null | undefined, locale: ContractLocale): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const name = MONTHS[locale][month - 1];
  if (!name) return iso;
  return locale === "es" ? `${day} de ${name} de ${year}` : `${name} ${day}, ${year}`;
}

/** Formats integer cents as "$1,234 USD" (whole dollars; the legacy contract uses no decimals). */
export function formatContractMoney(cents: number, currency: string): string {
  const dollars = Math.round(cents / 100);
  const grouped = dollars.toLocaleString("en-US");
  return `$${grouped} ${currency}`;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

/**
 * Assembles the full contract document from its inputs. The committed parties
 * must ALREADY be filtered to those included in the contract (the principal
 * client is rendered as EL CLIENTE and is not part of `committedParties`).
 */
export function buildContractDocument(input: ContractDocumentInput): ContractDocument {
  const b: ContractBoilerplate = CONTRACT_BOILERPLATE[input.locale];
  const { labels } = b;
  const sections: ContractSection[] = [];

  // 1) PARTES DEL CONTRATO
  const partyBlocks: ContractBlock[] = [];

  const consultorRows: Array<{ label: string; value: string }> = [
    { label: labels.company, value: input.consultor.companyName },
  ];
  if (input.consultor.representativeName)
    consultorRows.push({ label: labels.representative, value: input.consultor.representativeName });
  if (input.consultor.phone) consultorRows.push({ label: labels.phone, value: input.consultor.phone });
  if (input.consultor.zelleEmail)
    consultorRows.push({ label: labels.zelle, value: input.consultor.zelleEmail });
  partyBlocks.push({ kind: "fieldGroup", heading: b.partyGroups.consultor, rows: consultorRows });

  const clientRows: Array<{ label: string; value: string }> = [
    { label: labels.fullName, value: input.client.name ?? "—" },
  ];
  if (input.client.passport) clientRows.push({ label: labels.passport, value: input.client.passport });
  if (input.client.dateOfBirth)
    clientRows.push({ label: labels.dateOfBirth, value: formatContractDate(input.client.dateOfBirth, input.locale) });
  if (input.client.addressLine1) clientRows.push({ label: labels.address, value: input.client.addressLine1 });
  if (input.client.cityStateZip) clientRows.push({ label: labels.cityStateZip, value: input.client.cityStateZip });
  partyBlocks.push({ kind: "fieldGroup", heading: b.partyGroups.client, rows: clientRows });

  // Committed parties (children/beneficiaries). One field group per party; the
  // heading numbers them when there is more than one.
  input.committedParties.forEach((p, i) => {
    const heading =
      input.committedParties.length > 1
        ? `${p.roleLabel} ${i + 1}`
        : p.roleLabel;
    const rows: Array<{ label: string; value: string }> = [{ label: labels.fullName, value: p.name }];
    if (p.dateOfBirth)
      rows.push({ label: labels.dateOfBirth, value: formatContractDate(p.dateOfBirth, input.locale) });
    if (p.birthplace) rows.push({ label: labels.birthplace, value: p.birthplace });
    if (p.passport) rows.push({ label: labels.passport, value: p.passport });
    partyBlocks.push({ kind: "fieldGroup", heading, rows });
  });

  sections.push({ key: "parties", title: b.sectionTitles.parties, blocks: partyBlocks });

  // 2) OBJETO DEL CONTRATO
  if (input.objeto && input.objeto.trim()) {
    sections.push({
      key: "object",
      title: b.sectionTitles.object,
      blocks: [{ kind: "paragraph", text: input.objeto.trim() }],
    });
  }

  // 3) ALCANCE DEL SERVICIO
  const scopeItems = (input.alcance ?? []).map((s) => s.trim()).filter(Boolean);
  if (scopeItems.length > 0) {
    sections.push({
      key: "scope",
      title: b.sectionTitles.scope,
      blocks: [{ kind: "list", items: scopeItems }],
    });
  }

  // 4) HONORARIOS Y FORMA DE PAGO
  const { currency } = input.fees;
  const total = formatContractMoney(input.fees.totalCents, currency);
  const feesParas: string[] = [interpolate(b.feeSentences.total, { total })];
  const downpaymentCents = input.fees.downpaymentCents ?? 0;
  const installmentCount = input.fees.installmentCount ?? 1;
  if (installmentCount > 1) {
    const balanceCents = Math.max(0, input.fees.totalCents - downpaymentCents);
    const monthlyCount = downpaymentCents > 0 ? installmentCount - 1 : installmentCount;
    const monthlyCents = monthlyCount > 0 ? Math.round(balanceCents / monthlyCount) : balanceCents;
    feesParas.push(
      interpolate(b.feeSentences.installmentPlan, {
        downpayment: formatContractMoney(downpaymentCents, currency),
        balance: formatContractMoney(balanceCents, currency),
        count: String(monthlyCount),
        installment: formatContractMoney(monthlyCents, currency),
      }),
    );
  } else {
    feesParas.push(interpolate(b.feeSentences.singlePayment, { total }));
  }
  if (input.consultor.zelleEmail) {
    feesParas.push(interpolate(b.feeSentences.zelle, { zelle: input.consultor.zelleEmail }));
  }
  sections.push({
    key: "fees",
    title: b.sectionTitles.fees,
    blocks: feesParas.map((text) => ({ kind: "paragraph", text }) as ContractBlock),
  });

  // 5) CRONOGRAMA DE PAGOS
  if (input.schedule.length > 0) {
    const rows: Array<{ cells: [string, string, string]; emphasis?: boolean }> = input.schedule.map((row) => {
      const label = row.isDownpayment
        ? b.schedule.downpaymentRow
        : interpolate(b.schedule.installmentRow, { n: String(row.number) });
      return {
        cells: [
          label,
          formatContractDate(row.dueDate, input.locale),
          formatContractMoney(row.amountCents, currency),
        ] as [string, string, string],
      };
    });
    rows.push({
      cells: [b.schedule.totalRow, "", total] as [string, string, string],
      emphasis: true,
    });
    sections.push({
      key: "schedule",
      title: b.sectionTitles.schedule,
      blocks: [
        {
          kind: "scheduleTable",
          headers: [b.schedule.colInstallment, b.schedule.colDueDate, b.schedule.colAmount],
          rows,
        },
      ],
    });
  }

  // 6-9) Boilerplate legal blocks
  sections.push({
    key: "costs",
    title: b.sectionTitles.costs,
    blocks: b.costsParagraphs.map((text) => ({ kind: "paragraph", text }) as ContractBlock),
  });
  sections.push({
    key: "nature",
    title: b.sectionTitles.nature,
    blocks: b.natureParagraphs.map((text) => ({ kind: "paragraph", text }) as ContractBlock),
  });
  sections.push({
    key: "obligations",
    title: b.sectionTitles.obligations,
    blocks: [{ kind: "list", items: b.obligationsItems }],
  });
  sections.push({
    key: "cancellation",
    title: b.sectionTitles.cancellation,
    blocks: b.cancellationParagraphs.map((text) => ({ kind: "paragraph", text }) as ContractBlock),
  });

  // 10) CLÁUSULA ESPECIAL (per-service, optional)
  if (input.especial && input.especial.trim()) {
    sections.push({
      key: "special",
      title: b.sectionTitles.special,
      blocks: [{ kind: "paragraph", text: input.especial.trim() }],
    });
  }

  // 11) ACEPTACIÓN
  sections.push({
    key: "acceptance",
    title: b.sectionTitles.acceptance,
    blocks: [{ kind: "paragraph", text: b.acceptanceParagraph }],
  });

  return {
    title: b.contractTitle,
    subtitle: input.serviceLabel,
    dateLabel: formatContractDate(input.dateIso, input.locale),
    sections,
    signatures: {
      consultor: {
        name: input.consultor.representativeName ?? input.consultor.companyName,
        role: labels.consultorRole,
      },
      client: { name: input.client.name ?? "—", role: labels.clientRole },
    },
  };
}
