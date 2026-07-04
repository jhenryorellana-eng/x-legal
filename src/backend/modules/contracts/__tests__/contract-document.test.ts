/**
 * Contract document assembler — pure tests (TDD).
 *
 * No IO, no mocks. Verifies section order, the committed-parties rendering
 * (petitioner + children, no spouse), the fee clause, and the schedule table.
 */

import { describe, it, expect } from "vitest";
import {
  buildContractDocument,
  formatContractDate,
  formatContractMoney,
  type ContractDocumentInput,
} from "../contract-document";

function baseInput(overrides: Partial<ContractDocumentInput> = {}): ContractDocumentInput {
  return {
    locale: "es",
    dateIso: "2026-06-25",
    consultor: {
      companyName: "USA LATINO PRIME",
      representativeName: "Jimy Henry Orellana Domínguez",
      phone: "801-941-3479",
      zelleEmail: "Henryorellana@usalatinoprime.com",
    },
    serviceLabel: "Asilo Político",
    client: { name: "Carlos Mendoza" },
    committedParties: [],
    fees: { totalCents: 350000, downpaymentCents: 50000, installmentCount: 11, currency: "USD" },
    schedule: [],
    ...overrides,
  };
}

describe("formatContractMoney", () => {
  it("formats whole dollars with thousands separator", () => {
    expect(formatContractMoney(350000, "USD")).toBe("$3,500 USD");
    expect(formatContractMoney(50000, "USD")).toBe("$500 USD");
  });
});

describe("formatContractDate", () => {
  it("formats ISO dates in Spanish and English", () => {
    expect(formatContractDate("2026-06-25", "es")).toBe("25 de junio de 2026");
    expect(formatContractDate("2026-06-25", "en")).toBe("June 25, 2026");
  });
  it("returns empty string for nullish input", () => {
    expect(formatContractDate(null, "es")).toBe("");
    expect(formatContractDate(undefined, "en")).toBe("");
  });
});

describe("buildContractDocument", () => {
  it("uses the canonical title + service subtitle + localized date", () => {
    const doc = buildContractDocument(baseInput());
    expect(doc.title).toBe("CONTRATO DE PRESTACIÓN DE SERVICIOS");
    expect(doc.subtitle).toBe("Asilo Político");
    expect(doc.dateLabel).toBe("25 de junio de 2026");
  });

  it("commits the petitioner + the 3 children, and NOT the spouse (already filtered)", () => {
    // The spouse is excluded upstream (include_in_contract=false) so it is simply
    // not in committedParties — the contract must list only the children.
    const doc = buildContractDocument(
      baseInput({
        committedParties: [
          { roleLabel: "Hijo/a", name: "Hijo Uno" },
          { roleLabel: "Hijo/a", name: "Hijo Dos" },
          { roleLabel: "Hijo/a", name: "Hijo Tres" },
        ],
      }),
    );
    const parties = doc.sections.find((s) => s.key === "parties");
    expect(parties).toBeDefined();
    const headings = parties!.blocks
      .filter((bl): bl is Extract<typeof bl, { kind: "fieldGroup" }> => bl.kind === "fieldGroup")
      .map((bl) => bl.heading);
    expect(headings).toEqual(["EL CONSULTOR", "EL CLIENTE", "Hijo/a 1", "Hijo/a 2", "Hijo/a 3"]);
    // Nobody named "Cónyuge"/spouse appears anywhere in the document.
    expect(JSON.stringify(doc)).not.toMatch(/spouse|Cónyuge/i);
  });

  it("renders a single committed party without an index suffix", () => {
    const doc = buildContractDocument(
      baseInput({ committedParties: [{ roleLabel: "Hijo/a", name: "Único Hijo" }] }),
    );
    const parties = doc.sections.find((s) => s.key === "parties")!;
    const headings = parties.blocks
      .filter((bl): bl is Extract<typeof bl, { kind: "fieldGroup" }> => bl.kind === "fieldGroup")
      .map((bl) => bl.heading);
    expect(headings).toContain("Hijo/a");
    expect(headings).not.toContain("Hijo/a 1");
  });

  it("builds the installment fee clause with downpayment, balance, count and monthly amount", () => {
    const doc = buildContractDocument(baseInput());
    const fees = doc.sections.find((s) => s.key === "fees")!;
    const text = fees.blocks.map((bl) => (bl.kind === "paragraph" ? bl.text : "")).join(" ");
    expect(text).toContain("$3,500 USD"); // total
    expect(text).toContain("$500 USD"); // downpayment
    expect(text).toContain("$3,000 USD"); // balance
    expect(text).toContain("10 cuotas"); // 11 installments incl. downpayment → 10 monthly
    expect(text).toContain("$300 USD"); // monthly
    expect(text).toContain("Henryorellana@usalatinoprime.com");
  });

  it("uses the weekly fee clause when fees.frequency is weekly (es + en)", () => {
    const weeklyFees = {
      totalCents: 350000,
      downpaymentCents: 50000,
      installmentCount: 11,
      frequency: "weekly" as const,
      currency: "USD",
    };
    const es = buildContractDocument(baseInput({ fees: weeklyFees }));
    const esText = es.sections
      .find((s) => s.key === "fees")!
      .blocks.map((bl) => (bl.kind === "paragraph" ? bl.text : ""))
      .join(" ");
    expect(esText).toContain("cuotas semanales");
    expect(esText).not.toContain("cuotas mensuales");

    const en = buildContractDocument(baseInput({ locale: "en", fees: weeklyFees }));
    const enText = en.sections
      .find((s) => s.key === "fees")!
      .blocks.map((bl) => (bl.kind === "paragraph" ? bl.text : ""))
      .join(" ");
    expect(enText).toContain("weekly installments");
  });

  it("keeps the monthly fee clause when frequency is omitted (pre-0063 snapshots)", () => {
    const doc = buildContractDocument(baseInput());
    const text = doc.sections
      .find((s) => s.key === "fees")!
      .blocks.map((bl) => (bl.kind === "paragraph" ? bl.text : ""))
      .join(" ");
    expect(text).toContain("cuotas mensuales");
  });

  it("uses the single-payment clause when there is one installment", () => {
    const doc = buildContractDocument(
      baseInput({ fees: { totalCents: 250000, downpaymentCents: 0, installmentCount: 1, currency: "USD" } }),
    );
    const fees = doc.sections.find((s) => s.key === "fees")!;
    const text = fees.blocks.map((bl) => (bl.kind === "paragraph" ? bl.text : "")).join(" ");
    expect(text).toContain("único abono");
  });

  it("renders the schedule table with a TOTAL row", () => {
    const doc = buildContractDocument(
      baseInput({
        schedule: [
          { number: 0, amountCents: 50000, dueDate: "2026-06-23", isDownpayment: true },
          { number: 1, amountCents: 30000, dueDate: "2026-07-23" },
        ],
      }),
    );
    const schedule = doc.sections.find((s) => s.key === "schedule")!;
    const table = schedule.blocks[0];
    expect(table.kind).toBe("scheduleTable");
    if (table.kind === "scheduleTable") {
      expect(table.rows).toHaveLength(3); // downpayment + 1 installment + total
      expect(table.rows[0].cells[0]).toBe("Cuota inicial");
      expect(table.rows[2].emphasis).toBe(true);
      expect(table.rows[2].cells[2]).toBe("$3,500 USD");
    }
  });

  it("omits object/scope/special sections when not provided, keeps boilerplate", () => {
    const doc = buildContractDocument(baseInput());
    const keys = doc.sections.map((s) => s.key);
    expect(keys).not.toContain("object");
    expect(keys).not.toContain("scope");
    expect(keys).not.toContain("special");
    // Boilerplate is always present and in order.
    expect(keys).toEqual([
      "parties",
      "fees",
      "costs",
      "nature",
      "obligations",
      "cancellation",
      "acceptance",
    ]);
  });

  it("includes per-service object, scope and special clause when provided, in order", () => {
    const doc = buildContractDocument(
      baseInput({
        objeto: "El CONSULTOR se compromete a asistir el proceso de Asilo.",
        alcance: ["Evaluación inicial", "Preparación del I-589", "  ", "Presentación ante USCIS"],
        especial: "Cláusula especial del servicio.",
        schedule: [{ number: 0, amountCents: 50000, dueDate: "2026-06-23", isDownpayment: true }],
      }),
    );
    const keys = doc.sections.map((s) => s.key);
    expect(keys).toEqual([
      "parties",
      "object",
      "scope",
      "fees",
      "schedule",
      "costs",
      "nature",
      "obligations",
      "cancellation",
      "special",
      "acceptance",
    ]);
    const scope = doc.sections.find((s) => s.key === "scope")!;
    expect(scope.blocks[0]).toEqual({
      kind: "list",
      items: ["Evaluación inicial", "Preparación del I-589", "Presentación ante USCIS"], // blank trimmed
    });
  });

  it("signs as the representative (consultor) and the client", () => {
    const doc = buildContractDocument(baseInput());
    expect(doc.signatures.consultor.name).toBe("Jimy Henry Orellana Domínguez");
    expect(doc.signatures.client.name).toBe("Carlos Mendoza");
  });
});
