import { describe, it, expect } from "vitest";
import { resolveLetterFillTokens, type LetterFillInputs } from "../letter-fill";
import type { LetterFillConfig } from "../domain";
import { resolveOccAddress } from "@/shared/constants/occ-offices";

const STATEMENT_CFG: LetterFillConfig = {
  appellant_contact: {
    form_slug: "eoir-26",
    address_question: "¿Cuál es tu dirección (calle y número)?",
    apartment_question: "¿Tienes número de apartamento o cuarto? (opcional)",
    city_state_zip_question: "¿Cuál es tu ciudad, estado y código postal?",
    telephone_question: "¿Cuál es tu número de teléfono?",
    fallback_document_slug: "asilo-presentado-completo-con-anexos",
    fallback_fields: {
      street: "us_street_address",
      apartment: "us_apartment_number",
      city_state_zip: "us_city_state_zip",
      telephone: "us_phone",
    },
  },
};

const PROOF_CFG: LetterFillConfig = {
  occ_address: {
    decision_document_slug: "decision-y-orden-del-juez-de-inmigracion",
    court_json_path: "court_location",
    override_form_slug: "proof-of-service-cuestionario",
    override_question: "¿Cuál es la dirección de la oficina del Chief Counsel (DHS/OPLA)?",
  },
  service_method: {
    form_slug: "proof-of-service-cuestionario",
    method_question: "¿Cómo se enviará la copia al gobierno?",
  },
};

const ADDR_TEXT =
  "Address: {{APPELLANT_ADDRESS}}<br>City / State / ZIP: {{APPELLANT_CITY_STATE_ZIP}}<br>Telephone: {{APPELLANT_TELEPHONE}}";

function mk(partial: Partial<LetterFillInputs>): LetterFillInputs {
  return { documents: partial.documents ?? [], forms: partial.forms ?? [] };
}

describe("resolveLetterFillTokens — appellant contact", () => {
  it("stamps the CONFIRMED EOIR-26 answer (it wins over the raw extraction)", () => {
    const inputs = mk({
      forms: [
        {
          slug: "eoir-26",
          answers: {
            "¿Cuál es tu dirección (calle y número)?": "742 Evergreen Terrace",
            "¿Cuál es tu ciudad, estado y código postal?": "Houston, TX 77002",
            "¿Cuál es tu número de teléfono?": "(832) 555-0164",
          },
        },
      ],
      documents: [
        {
          slug: "asilo-presentado-completo-con-anexos",
          extractionPayload: { us_street_address: "OLD 1 Stale St", us_city_state_zip: "OLD City", us_phone: "000" },
        },
      ],
    });
    const out = resolveLetterFillTokens(ADDR_TEXT, STATEMENT_CFG, inputs);
    expect(out).toContain("Address: 742 Evergreen Terrace<br>");
    expect(out).toContain("City / State / ZIP: Houston, TX 77002<br>");
    expect(out).toContain("Telephone: (832) 555-0164");
    expect(out).not.toContain("Stale");
    expect(out).not.toContain("{{");
  });

  it("falls back to the I-589 extraction when the confirmed answer is empty", () => {
    const inputs = mk({
      forms: [{ slug: "eoir-26", answers: { "¿Cuál es tu dirección (calle y número)?": "  " } }],
      documents: [
        {
          slug: "asilo-presentado-completo-con-anexos",
          extractionPayload: {
            us_street_address: "126 Northpoint Drive",
            us_city_state_zip: "Houston, TX 77060",
            us_phone: "(713) 555-9000",
          },
        },
      ],
    });
    const out = resolveLetterFillTokens(ADDR_TEXT, STATEMENT_CFG, inputs);
    expect(out).toContain("Address: 126 Northpoint Drive<br>");
    expect(out).toContain("City / State / ZIP: Houston, TX 77060<br>");
    expect(out).toContain("Telephone: (713) 555-9000");
  });

  it("appends the apartment when present", () => {
    const inputs = mk({
      documents: [
        {
          slug: "asilo-presentado-completo-con-anexos",
          extractionPayload: { us_street_address: "500 Main St", us_apartment_number: "4B" },
        },
      ],
    });
    const out = resolveLetterFillTokens(ADDR_TEXT, STATEMENT_CFG, inputs);
    expect(out).toContain("Address: 500 Main St, Apt 4B<br>");
  });

  it("degrades to a printable line when neither the answer nor the extraction has a value", () => {
    const out = resolveLetterFillTokens(ADDR_TEXT, STATEMENT_CFG, mk({}));
    expect(out).toContain("Address: ______________________________<br>");
    expect(out).toContain("Telephone: ______________________________");
    expect(out).not.toContain("{{");
  });

  it("preserves a literal '$' in the address (function replacer, no $-pattern interpretation)", () => {
    const inputs = mk({
      forms: [{ slug: "eoir-26", answers: { "¿Cuál es tu dirección (calle y número)?": "$5 Dollar St, Apt $&1" } }],
    });
    const out = resolveLetterFillTokens(ADDR_TEXT, STATEMENT_CFG, inputs);
    expect(out).toContain("Address: $5 Dollar St, Apt $&1<br>");
  });

  it("reports each degraded field via onFallback", () => {
    const fallbacks: string[] = [];
    resolveLetterFillTokens(ADDR_TEXT, STATEMENT_CFG, mk({}), (f) => fallbacks.push(f));
    expect(fallbacks).toEqual(["appellant_address", "appellant_city_state_zip", "appellant_telephone"]);
  });
});

describe("resolveLetterFillTokens — OCC address (Proof of Service)", () => {
  const OCC_TEXT = "at the following address:\n\n{{OCC_ADDRESS}}\n\nMethod of service (check one):<br>{{SERVICE_METHOD_CHECKBOXES}}";

  it("resolves the court→OCC address for a known court", () => {
    const inputs = mk({
      documents: [
        {
          slug: "decision-y-orden-del-juez-de-inmigracion",
          extractionPayload: { court_location: "Immigration Court, Houston, TX" },
        },
      ],
    });
    const out = resolveLetterFillTokens(OCC_TEXT, PROOF_CFG, inputs);
    expect(out).toContain("126 Northpoint Drive, Room 2020<br>Houston, TX 77060");
    expect(out).not.toContain("{{OCC_ADDRESS}}");
  });

  it("keeps an honest placeholder for a court not in the directory (never invents one)", () => {
    const inputs = mk({
      documents: [
        {
          slug: "decision-y-orden-del-juez-de-inmigracion",
          extractionPayload: { court_location: "Immigration Court, Boise, ID" },
        },
      ],
    });
    const out = resolveLetterFillTokens(OCC_TEXT, PROOF_CFG, inputs);
    expect(out).toContain("[OFFICE OF THE CHIEF COUNSEL ADDRESS");
    expect(out).not.toContain("{{OCC_ADDRESS}}");
  });

  it("prefers a confirmed override address over the court→OCC lookup", () => {
    const inputs = mk({
      documents: [
        {
          slug: "decision-y-orden-del-juez-de-inmigracion",
          extractionPayload: { court_location: "Immigration Court, Houston, TX" },
        },
      ],
      forms: [
        {
          slug: "proof-of-service-cuestionario",
          answers: { "¿Cuál es la dirección de la oficina del Chief Counsel (DHS/OPLA)?": "OCC Custom Office\n123 Override Ave\nBoise, ID 83702" },
        },
      ],
    });
    const out = resolveLetterFillTokens(OCC_TEXT, PROOF_CFG, inputs);
    expect(out).toContain("OCC Custom Office<br>123 Override Ave<br>Boise, ID 83702");
    expect(out).not.toContain("126 Northpoint");
  });

  it("marks the chosen service method and leaves the others blank", () => {
    const inputs = mk({
      documents: [
        {
          slug: "decision-y-orden-del-juez-de-inmigracion",
          extractionPayload: { court_location: "Immigration Court, Houston, TX" },
        },
      ],
      forms: [
        { slug: "proof-of-service-cuestionario", answers: { "¿Cómo se enviará la copia al gobierno?": "first_class_mail" } },
      ],
    });
    const out = resolveLetterFillTokens(OCC_TEXT, PROOF_CFG, inputs);
    expect(out).toContain("[X] First-class United States mail, postage prepaid");
    expect(out).toContain("[ ] Personal delivery (hand service)");
    expect(out).toContain("[ ] Electronic service through ECAS");
    expect(out).not.toContain("{{SERVICE_METHOD_CHECKBOXES}}");
  });

  it("leaves all method boxes blank when the client has not chosen yet", () => {
    const out = resolveLetterFillTokens(OCC_TEXT, PROOF_CFG, mk({}));
    expect(out).toContain("[ ] First-class United States mail, postage prepaid");
    expect(out).not.toContain("[X]");
  });
});

describe("resolveLetterFillTokens — guards", () => {
  it("returns the text unchanged when there is no letter_fill config", () => {
    expect(resolveLetterFillTokens(ADDR_TEXT, null, mk({}))).toBe(ADDR_TEXT);
  });
});

describe("resolveOccAddress", () => {
  it("matches Houston court variants", () => {
    expect(resolveOccAddress("Immigration Court, Houston, TX")?.join(" ")).toContain("126 Northpoint Drive");
    expect(resolveOccAddress("Houston - S. Gessner Road Immigration Court")?.join(" ")).toContain("77060");
  });
  it("matches Salt Lake City / West Valley", () => {
    expect(resolveOccAddress("Immigration Court, Salt Lake City, UT")?.join(" ")).toContain("Decker Lake");
  });
  it("returns null for an unknown court or empty input", () => {
    expect(resolveOccAddress("Immigration Court, Boise, ID")).toBeNull();
    expect(resolveOccAddress(null)).toBeNull();
    expect(resolveOccAddress("")).toBeNull();
  });
});
