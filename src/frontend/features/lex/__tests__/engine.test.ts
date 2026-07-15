/**
 * Deterministic Lex engine — unit tests (TDD).
 *
 * The engine is a pure function of a typed context. These tests pin:
 *  - threshold gating (0 vs >0) per role,
 *  - tone ranking (danger > warn > info > celebrate) when several fire,
 *  - the fallback/celebrate message when nothing urgent fires,
 *  - the biggest-funnel-leak computation for admin (real, not hardcoded),
 *  - that actions carry deep-links / handler ids.
 */
import { describe, it, expect } from "vitest";
import { buildLexInsight } from "../engine";
import type {
  AdminHomeContext,
  FinanceHomeContext,
  LegalHomeContext,
  SalesHomeContext,
} from "../types";

const sales = (o: Partial<SalesHomeContext>): SalesHomeContext => ({
  role: "sales",
  uncontacted: 0,
  topLeadName: null,
  ...o,
});
const legal = (o: Partial<LegalHomeContext>): LegalHomeContext => ({
  role: "legal",
  docsToReview: 0,
  docsCases: 0,
  corrections: 0,
  failedGen: 0,
  rfeOverdue: 0,
  activeCases: 0,
  ...o,
});
const finance = (o: Partial<FinanceHomeContext>): FinanceHomeContext => ({
  role: "finance",
  overdueCases: 0,
  overdueAmount: "$0",
  printQueue: 0,
  collectedCents: 0,
  collectedAmount: "$0",
  collectedTrendLabel: null,
  ...o,
});
const admin = (o: Partial<AdminHomeContext>): AdminHomeContext => ({
  role: "admin",
  overdueCases: 0,
  overdueAmount: "$0",
  activeCases: 0,
  conversionLabel: "—",
  funnel: { newLeads: 0, contacted: 0, won: 0 },
  stageLabels: { leads: "Leads", contacted: "Contactado", won: "Ganado" },
  ...o,
});

describe("lex engine · sales", () => {
  it("nudges the priority lead when there are uncontacted leads", () => {
    const i = buildLexInsight(sales({ uncontacted: 3, topLeadName: "Lucía" }))!;
    expect(i.tone).toBe("warn");
    expect(i.messageKey).toBe("sales.priority");
    expect(i.params).toMatchObject({ n: 3, name: "Lucía" });
    // Offers a real action to contact the top lead.
    expect(i.actions.map((a) => a.id)).toContain("contactTopLead");
  });

  it("celebrates when the inbox is clear", () => {
    const i = buildLexInsight(sales({ uncontacted: 0 }))!;
    expect(i.tone).toBe("celebrate");
    expect(i.messageKey).toBe("sales.clear");
  });
});

describe("lex engine · legal", () => {
  it("prioritises an overdue RFE (danger) over lower-severity alerts", () => {
    const i = buildLexInsight(
      legal({ rfeOverdue: 1, corrections: 2, docsToReview: 5, docsCases: 3 }),
    )!;
    expect(i.tone).toBe("danger");
    expect(i.messageKey).toBe("legal.rfeOverdue");
    expect(i.params).toMatchObject({ n: 1 });
  });

  it("surfaces the docs-to-review queue with case count + deep-link", () => {
    const i = buildLexInsight(legal({ docsToReview: 7, docsCases: 3, activeCases: 8 }))!;
    expect(i.tone).toBe("warn");
    expect(i.messageKey).toBe("legal.docsToReview");
    expect(i.params).toMatchObject({ n: 7, cases: 3 });
    expect(i.actions.some((a) => a.href === "/legal/por-revisar")).toBe(true);
  });

  it("falls back to an all-clear info message", () => {
    const i = buildLexInsight(legal({ activeCases: 4 }))!;
    expect(i.tone).toBe("info");
    expect(i.messageKey).toBe("legal.clear");
    expect(i.params).toMatchObject({ active: 4 });
  });
});

describe("lex engine · finance", () => {
  it("prioritises overdue cases (danger) with amount + deep-link", () => {
    const i = buildLexInsight(
      finance({ overdueCases: 3, overdueAmount: "$1,200", printQueue: 2, collectedCents: 500000 }),
    )!;
    expect(i.tone).toBe("danger");
    expect(i.messageKey).toBe("finance.overdue");
    expect(i.params).toMatchObject({ n: 3, amount: "$1,200" });
    expect(i.actions.some((a) => a.href === "/finanzas/pagos")).toBe(true);
  });

  it("nudges the print queue when nothing is overdue", () => {
    const i = buildLexInsight(finance({ overdueCases: 0, printQueue: 4 }))!;
    expect(i.tone).toBe("warn");
    expect(i.messageKey).toBe("finance.print");
    expect(i.params).toMatchObject({ n: 4 });
  });

  it("celebrates a clean ledger", () => {
    const i = buildLexInsight(finance({}))!;
    expect(i.tone).toBe("celebrate");
    expect(i.messageKey).toBe("finance.clear");
  });
});

describe("lex engine · admin", () => {
  it("prioritises org morosidad (danger)", () => {
    const i = buildLexInsight(
      admin({ overdueCases: 5, overdueAmount: "$8,000", activeCases: 20, conversionLabel: "24%" }),
    )!;
    expect(i.tone).toBe("danger");
    expect(i.messageKey).toBe("admin.overdue");
    expect(i.params).toMatchObject({ n: 5, amount: "$8,000" });
  });

  it("computes the biggest funnel leak from real stage counts", () => {
    // leads→contacted drop = (100-40)/100 = 60%; contacted→won = (40-30)/40 = 25%.
    const i = buildLexInsight(
      admin({
        funnel: { newLeads: 100, contacted: 40, won: 30 },
        conversionLabel: "30%",
        stageLabels: { leads: "Leads", contacted: "Contactado", won: "Ganado" },
      }),
    )!;
    expect(i.tone).toBe("warn");
    expect(i.messageKey).toBe("admin.leak");
    expect(i.params).toMatchObject({ from: "Leads", to: "Contactado", drop: 60 });
  });

  it("picks the contacted→won leak when it is the largest", () => {
    // leads→contacted = (100-90)/100 = 10%; contacted→won = (90-20)/90 = 78%.
    const i = buildLexInsight(
      admin({ funnel: { newLeads: 100, contacted: 90, won: 20 }, conversionLabel: "20%" }),
    )!;
    expect(i.messageKey).toBe("admin.leak");
    expect(i.params).toMatchObject({ from: "Contactado", to: "Ganado", drop: 78 });
  });

  it("celebrates when there is no morosidad and no meaningful leak", () => {
    const i = buildLexInsight(
      admin({ funnel: { newLeads: 10, contacted: 10, won: 10 }, activeCases: 12, conversionLabel: "100%" }),
    )!;
    expect(i.tone).toBe("celebrate");
    expect(i.messageKey).toBe("admin.clear");
    expect(i.params).toMatchObject({ active: 12, conv: "100%" });
  });

  it("does not invent a leak when there are no leads", () => {
    const i = buildLexInsight(admin({ funnel: { newLeads: 0, contacted: 0, won: 0 } }))!;
    expect(i.messageKey).toBe("admin.clear");
  });
});
