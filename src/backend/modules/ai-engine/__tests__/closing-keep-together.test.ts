/**
 * markClosingBlockKeepTogether — pure placement of the renderer's KEEP_TOGETHER_MARKER
 * at the start of a letter's closing block (anchored on the signature token, extended
 * up to a SHORT lead-in line, never a long body paragraph). No-ops without a signature.
 */
import { describe, it, expect } from "vitest";
import { markClosingBlockKeepTogether } from "../letter-fill";
import { KEEP_TOGETHER_MARKER } from "@/backend/platform/pdf";

const STATEMENT =
  "For all the foregoing reasons, I respectfully request that the Board reverse the decision and grant relief, or in the alternative vacate and remand for a full merits hearing on all applications.\n\n" +
  "Respectfully submitted,\n\n" +
  "{{APPELLANT_SIGNATURE}}\n\n" +
  "**PALMA RODRIGUEZ, IVIS MICHELL**<br>Respondent, Pro Se\n\n" +
  "Address: {{APPELLANT_ADDRESS}}<br>City / State / ZIP: {{APPELLANT_CITY_STATE_ZIP}}<br>Telephone: {{APPELLANT_TELEPHONE}}\n\n" +
  "Date: {{CURRENT_DATE}}";

describe("markClosingBlockKeepTogether", () => {
  it("inserts the marker right before the short lead-in ('Respectfully submitted,')", () => {
    const out = markClosingBlockKeepTogether(STATEMENT);
    expect(out).toContain(`${KEEP_TOGETHER_MARKER}Respectfully submitted,`);
    // The long prayer paragraph stays OUTSIDE the kept-together block.
    expect(out.indexOf("For all the foregoing")).toBeLessThan(out.indexOf(KEEP_TOGETHER_MARKER));
    // Exactly one marker.
    expect(out.split(KEEP_TOGETHER_MARKER).length).toBe(2);
  });

  it("keeps the perjury declaration (a short lead-in) with the signature (Proof)", () => {
    const proof =
      "...at the following address:\n\n{{OCC_ADDRESS}}\n\n" +
      "Method of service (check one):\n{{SERVICE_METHOD_CHECKBOXES}}\n\n" +
      "I declare under penalty of perjury that the foregoing is true and correct.\n\n" +
      "{{APPELLANT_SIGNATURE}}\n\n**NAME**<br>Respondent, Pro Se\n\nDate of service: {{CURRENT_DATE}}";
    const out = markClosingBlockKeepTogether(proof);
    expect(out).toContain(`${KEEP_TOGETHER_MARKER}I declare under penalty of perjury`);
  });

  it("does NOT pull in a long paragraph directly above the signature", () => {
    const long = "x".repeat(200);
    const md = `${long}\n\n{{APPELLANT_SIGNATURE}}\n\n**NAME**\n\nDate: {{CURRENT_DATE}}`;
    const out = markClosingBlockKeepTogether(md);
    // The marker sits before the signature paragraph, not before the 200-char block.
    expect(out).toContain(`${KEEP_TOGETHER_MARKER}{{APPELLANT_SIGNATURE}}`);
    expect(out.indexOf(long)).toBeLessThan(out.indexOf(KEEP_TOGETHER_MARKER));
  });

  it("no-ops when the letter has no signature token", () => {
    const md = "A plain letter with no signature line.\n\nJust body text.";
    expect(markClosingBlockKeepTogether(md)).toBe(md);
  });
});
