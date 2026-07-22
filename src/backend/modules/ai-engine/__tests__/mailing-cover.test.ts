import { describe, it, expect } from "vitest";
import { resolveMailingCoverValues, splitAddressLines } from "../mailing-cover";
import type { MailingCoverConfig } from "../domain";

/**
 * resolveMailingCoverValues — maps a mailing_cover config + resolved answers into
 * the renderer's data shape. Pure: no DB. The two variable values (client name,
 * OPLA address) come from CONFIRMED companion-questionnaire answers, keyed by
 * question wording (as loadResolvedInputs re-keys them).
 */
const CFG: MailingCoverConfig = {
  return_address: ["10951 N. Town Center Drive", "Highland, UT 84003"],
  sender_name: { form_slug: "caratula-de-envio-cuestionario", question: "Nombre completo del cliente" },
  envelopes: [
    {
      recipient_lines: ["Board of Immigration Appeals", "5107 Leesburg Pike, Suite 2000", "Falls Church, VA 22041"],
      address_from: null,
    },
    {
      recipient_lines: ["Office of the Principal Legal Advisor (OPLA)", "U.S. Immigration and Customs Enforcement"],
      address_from: { form_slug: "caratula-de-envio-cuestionario", question: "Dirección de OPLA" },
    },
  ],
  spacing: { block_gap_pt: 120, line_height: 1.5, font_size_pt: 13, margin_pt: 96 },
};

const INPUTS = {
  forms: [
    {
      slug: "caratula-de-envio-cuestionario",
      answers: {
        "Nombre completo del cliente": "Jhonathan Arthur Arcaya Angeles",
        "Dirección de OPLA": "500 North Orange Avenue, Suite 5000\nOrlando, FL 32801",
      },
      declaredGaps: [],
    },
  ],
};

describe("resolveMailingCoverValues", () => {
  it("resolves the sender name from the confirmed answer", () => {
    const d = resolveMailingCoverValues(CFG, INPUTS);
    expect(d.senderName).toBe("Jhonathan Arthur Arcaya Angeles");
  });

  it("splits the OPLA address into 2 lines on the OPLA envelope; the BIA envelope has none", () => {
    const d = resolveMailingCoverValues(CFG, INPUTS);
    expect(d.envelopes[0].addressLines).toEqual([]);
    expect(d.envelopes[1].addressLines).toEqual(["500 North Orange Avenue, Suite 5000", "Orlando, FL 32801"]);
    expect(d.envelopes[0].recipientLines[0]).toBe("Board of Immigration Appeals");
  });

  it("passes the return address through and applies spacing defaults when absent", () => {
    const d = resolveMailingCoverValues({ ...CFG, spacing: {} }, INPUTS);
    expect(d.returnAddress).toEqual(["10951 N. Town Center Drive", "Highland, UT 84003"]);
    expect(d.spacing).toEqual({ blockGapPt: 120, lineHeight: 1.5, fontSizePt: 13, marginPt: 96 });
  });

  it("degrades to empty strings when an answer is missing (no crash)", () => {
    const d = resolveMailingCoverValues(CFG, { forms: [] });
    expect(d.senderName).toBe("");
    expect(d.envelopes[1].addressLines).toEqual([]);
  });
});

describe("splitAddressLines", () => {
  it("splits on newlines and <br>, trimming blanks", () => {
    expect(splitAddressLines("a\n\nb")).toEqual(["a", "b"]);
    expect(splitAddressLines("a<br>b")).toEqual(["a", "b"]);
    expect(splitAddressLines("  solo una línea  ")).toEqual(["solo una línea"]);
    expect(splitAddressLines("")).toEqual([]);
  });
});
