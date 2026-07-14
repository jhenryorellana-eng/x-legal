/**
 * integrations module — domain unit tests (RED → GREEN TDD)
 *
 * Pure functions, zero I/O, zero mocks.
 * Covers DOC-70 §2.3, §2.4, §2.4.1 serializers + Zod schemas.
 */

import { describe, it, expect, vi } from "vitest";

// domain.ts imports canonicalClientLabel from expediente, which transitively
// loads supabase/authz platform modules. Mock them to keep domain tests pure.
vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));
vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
}));
vi.mock("@/backend/platform/env", () => ({
  env: {},
  providerEnv: vi.fn(),
}));
// Mock expediente module to avoid deep import chain
vi.mock("@/backend/modules/expediente", () => ({
  canonicalClientLabel: (first: string, last: string) =>
    `${(first ?? "").trim().charAt(0).toUpperCase()}. ${(last ?? "").trim()}`,
}));

import {
  buildClientLabel,
  serializeAutomatedForm,
  buildAnnexIndex,
  AbogadosPostPayloadSchema,
  AbogadosPostResponseSchema,
  AbogadosVerdictWebhookSchema,
  AbogadosPollingResponseSchema,
  LEGAL_VALIDATION_ACTIVE_STATUSES,
} from "../domain";

// ---------------------------------------------------------------------------
// buildClientLabel — DOC-70 §2.3
// ---------------------------------------------------------------------------

describe("buildClientLabel", () => {
  it("formats initial + first word of last name", () => {
    expect(buildClientLabel("Juan", "Vásquez")).toBe("J. Vásquez");
  });

  it("trims leading/trailing whitespace", () => {
    expect(buildClientLabel("  María  ", "  García  ")).toBe("M. García");
  });

  it("uses first char of multi-word first name", () => {
    expect(buildClientLabel("María José", "López")).toBe("M. López");
  });

  it("preserves compound last name — only first word", () => {
    // DOC-70 §2.3: "primera palabra del apellido con su partícula si la tiene"
    // Simplest rule: take the first whitespace-separated word of lastName
    expect(buildClientLabel("Ana", "De La Cruz")).toBe("A. De La Cruz");
  });

  it("handles single-char first name", () => {
    expect(buildClientLabel("A", "Smith")).toBe("A. Smith");
  });

  it("uppercases the initial", () => {
    expect(buildClientLabel("pedro", "ramírez")).toBe("P. ramírez");
  });

  it("empty strings produce safe fallback", () => {
    const label = buildClientLabel("", "");
    expect(label).toBe(". ");
  });
});

// ---------------------------------------------------------------------------
// serializeAutomatedForm — DOC-70 §2.4.1
// ---------------------------------------------------------------------------

describe("serializeAutomatedForm", () => {
  const BASE_FORM = {
    label: "I-360 — Petition",
    versionNo: 3,
    versionLabel: "publicada",
    partyLabel: null as string | null,
    groups: [
      {
        id: "g1",
        title_i18n: { es: "Información del beneficiario", en: "Beneficiary info" },
        position: 1,
        questions: [
          {
            id: "q1",
            question_i18n: { es: "Nombre completo del menor", en: "Full name" },
            pdf_field_name: "form1.Pt1Line1",
            field_type: "text",
            is_required: true,
            options: null as Array<{ value: string; label_i18n: { es: string; en: string } }> | null,
            answer: "VASQUEZ" as unknown,
          },
          {
            id: "q2",
            question_i18n: { es: "Fecha de nacimiento", en: "Date of birth" },
            pdf_field_name: "form1.Pt1Line5_DOB",
            field_type: "date",
            is_required: true,
            options: null,
            answer: "2012-03-14" as unknown,
          },
          {
            id: "q3",
            question_i18n: { es: "¿Bajo custodia estatal?", en: "State custody?" },
            pdf_field_name: "form1.Pt2Line3",
            field_type: "checkbox",
            is_required: false,
            options: null,
            answer: true as unknown,
          },
          {
            id: "q4",
            question_i18n: { es: "Campo requerido sin respuesta", en: "Required unanswered" },
            pdf_field_name: "form1.Pt3Line2",
            field_type: "text",
            is_required: true,
            options: null,
            answer: null as unknown,
          },
        ],
      },
    ],
  };

  it("emits correct header line", () => {
    const text = serializeAutomatedForm(BASE_FORM);
    expect(text).toContain("FORMULARIO: I-360 — Petition");
  });

  it("emits version line", () => {
    const text = serializeAutomatedForm(BASE_FORM);
    expect(text).toContain("Versión de automatización: 3 (publicada)");
  });

  it("emits group header as H3", () => {
    const text = serializeAutomatedForm(BASE_FORM);
    expect(text).toContain("### Información del beneficiario");
  });

  it("emits text field as 'label [field]: value'", () => {
    const text = serializeAutomatedForm(BASE_FORM);
    expect(text).toContain("Nombre completo del menor [form1.Pt1Line1]: VASQUEZ");
  });

  it("formats date answer as YYYY-MM-DD (passthrough)", () => {
    const text = serializeAutomatedForm(BASE_FORM);
    expect(text).toContain("Fecha de nacimiento [form1.Pt1Line5_DOB]: 2012-03-14");
  });

  it("formats checkbox true as 'Sí'", () => {
    const text = serializeAutomatedForm(BASE_FORM);
    expect(text).toContain("¿Bajo custodia estatal? [form1.Pt2Line3]: Sí");
  });

  it("emits [SIN RESPUESTA] for required null answer", () => {
    const text = serializeAutomatedForm(BASE_FORM);
    expect(text).toContain("Campo requerido sin respuesta [form1.Pt3Line2]: [SIN RESPUESTA]");
  });

  it("formats select answer as 'label (value)'", () => {
    const formWithSelect = {
      ...BASE_FORM,
      groups: [
        {
          ...BASE_FORM.groups[0],
          questions: [
            {
              id: "q-select",
              question_i18n: { es: "Estado civil", en: "Marital status" },
              pdf_field_name: "form1.Pt1MaritalStatus",
              field_type: "select",
              is_required: true,
              options: [
                { value: "single", label_i18n: { es: "Soltero/a", en: "Single" } },
                { value: "married", label_i18n: { es: "Casado/a", en: "Married" } },
              ],
              answer: "married",
            },
          ],
        },
      ],
    };
    const text = serializeAutomatedForm(formWithSelect);
    expect(text).toContain("Estado civil [form1.Pt1MaritalStatus]: Casado/a (married)");
  });

  it("formats checkbox false as 'No'", () => {
    const formWithFalse = {
      ...BASE_FORM,
      groups: [
        {
          ...BASE_FORM.groups[0],
          questions: [
            {
              id: "q-check",
              question_i18n: { es: "¿Tiene antecedentes?", en: "Has prior?" },
              pdf_field_name: "form1.prior",
              field_type: "checkbox",
              is_required: false,
              options: null,
              answer: false,
            },
          ],
        },
      ],
    };
    expect(serializeAutomatedForm(formWithFalse)).toContain("¿Tiene antecedentes? [form1.prior]: No");
  });

  it("includes partyLabel in header when provided", () => {
    const formWithParty = { ...BASE_FORM, partyLabel: "Mateo V. (minor)" };
    const text = serializeAutomatedForm(formWithParty);
    expect(text).toContain("Parte: Mateo V. (minor)");
  });

  it("is deterministic — same input produces same output", () => {
    const a = serializeAutomatedForm(BASE_FORM);
    const b = serializeAutomatedForm(BASE_FORM);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildAnnexIndex — DOC-70 §2.4 (Índice de anexos)
// ---------------------------------------------------------------------------

describe("buildAnnexIndex", () => {
  const items = [
    { position: 1, title: "Declaración del tutor", item_type: "ai_generation", page_count: 5, textIncluded: true },
    { position: 2, title: "Formulario I-360", item_type: "automated_form", page_count: 3, textIncluded: true },
    { position: 3, title: "Pasaporte (escaneo)", item_type: "client_document", page_count: 2, textIncluded: false },
    { position: 4, title: "Foto carnet", item_type: "external_file", page_count: 1, textIncluded: false },
  ];

  it("returns document with correct name", () => {
    const doc = buildAnnexIndex(items);
    expect(doc.name).toBe("Índice del expediente y anexos no incluidos");
  });

  it("returns document with kind 'other'", () => {
    const doc = buildAnnexIndex(items);
    expect(doc.kind).toBe("other");
  });

  it("lists all items in content", () => {
    const doc = buildAnnexIndex(items);
    expect(doc.content).toContain("Declaración del tutor");
    expect(doc.content).toContain("Formulario I-360");
    expect(doc.content).toContain("Pasaporte (escaneo)");
    expect(doc.content).toContain("Foto carnet");
  });

  it("marks text-included items accordingly", () => {
    const doc = buildAnnexIndex(items);
    expect(doc.content).toContain("[texto incluido en paquete]");
    expect(doc.content).toContain("[solo referencia — no incluido]");
  });

  it("preserves order by position", () => {
    const doc = buildAnnexIndex(items);
    const lines = doc.content.split("\n").filter((l) => l.startsWith("#") || /^\d/.test(l));
    const positions = lines.map((l) => parseInt(l.match(/^(\d+)/)?.[1] ?? "0"));
    expect(positions).toEqual([1, 2, 3, 4]);
  });

  it("includes page_count", () => {
    const doc = buildAnnexIndex(items);
    expect(doc.content).toContain("5 pág");
  });

  it("is deterministic", () => {
    expect(buildAnnexIndex(items)).toEqual(buildAnnexIndex(items));
  });
});

// ---------------------------------------------------------------------------
// Zod schemas — mirrors of the SaaS contract (DOC-70 §2.1, §3, §4.1, §6)
// ---------------------------------------------------------------------------

describe("AbogadosPostPayloadSchema", () => {
  const valid = {
    external_case_id: "11111111-1111-4111-8111-111111111111",
    source: "usalatinoprime-v2",
    case_number: "U26-000042",
    service_slug: "visa-juvenil",
    service_name: "Visa Juvenil",
    client_label: "J. Vásquez",
    documents: [{ name: "Declaración", kind: "declaration", content: "texto..." }],
    review: null,
    callback_url: "https://app.usalatinoprime.com/api/webhooks/abogados",
  };

  it("accepts valid payload", () => {
    expect(AbogadosPostPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing documents", () => {
    const { documents: _d, ...rest } = valid;
    expect(AbogadosPostPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects empty documents array", () => {
    expect(AbogadosPostPayloadSchema.safeParse({ ...valid, documents: [] }).success).toBe(false);
  });

  it("rejects invalid document kind", () => {
    const bad = { ...valid, documents: [{ name: "x", kind: "pdf", content: "y" }] };
    expect(AbogadosPostPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts null optional fields", () => {
    const minimal = {
      external_case_id: "abc",
      source: "usalatinoprime-v2",
      documents: [{ name: "doc", content: "txt" }],
      review: null,
    };
    expect(AbogadosPostPayloadSchema.safeParse(minimal).success).toBe(true);
  });
});

describe("AbogadosPostResponseSchema", () => {
  it("accepts 202 body", () => {
    const body = { validation_id: "vid", status: "queued", semaforo: null, prereview: "pending" };
    expect(AbogadosPostResponseSchema.safeParse(body).success).toBe(true);
  });

  it("accepts 200-dedup body", () => {
    const body = { validation_id: "vid", status: "queued", semaforo: "green", deduplicated: true };
    expect(AbogadosPostResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe("AbogadosVerdictWebhookSchema", () => {
  const validVerdict = {
    event: "validation.verdict",
    validation_id: "vid",
    external_case_id: "eid",
    source: "usalatinoprime-v2",
    case_number: "U26-000042",
    verdict: "validated",
    verdict_notes: "All good",
    verdict_findings: [],
    verdict_at: "2026-06-10T21:56:21.849+00:00",
    review_seconds: 53,
    return_to: "team",
    semaforo: "green",
    ai_score: 85,
  };

  it("accepts valid verdict payload", () => {
    expect(AbogadosVerdictWebhookSchema.safeParse(validVerdict).success).toBe(true);
  });

  it("accepts needs_corrections with findings", () => {
    const nc = {
      ...validVerdict,
      verdict: "needs_corrections",
      return_to: "client",
      semaforo: "red",
      ai_score: 42,
      verdict_findings: [
        {
          severity: "critical",
          category: "placeholder_unresolved",
          location: "párrafo 1",
          description: "No resolved",
          recommendation: "Fill it",
        },
      ],
    };
    expect(AbogadosVerdictWebhookSchema.safeParse(nc).success).toBe(true);
  });

  it("rejects invalid verdict value", () => {
    expect(AbogadosVerdictWebhookSchema.safeParse({ ...validVerdict, verdict: "rejected" }).success).toBe(false);
  });

  it("rejects invalid severity", () => {
    const bad = {
      ...validVerdict,
      verdict: "needs_corrections",
      verdict_findings: [{ severity: "blocker", category: "x", location: "y", description: "d", recommendation: "r" }],
    };
    expect(AbogadosVerdictWebhookSchema.safeParse(bad).success).toBe(false);
  });
});

describe("AbogadosPollingResponseSchema", () => {
  it("accepts polling response", () => {
    const body = {
      validation: {
        id: "vid",
        external_case_id: "eid",
        source: "usalatinoprime-v2",
        case_number: "U26-000042",
        status: "in_review",
        semaforo: "amber",
        ai_score: 70,
        prereview_status: "done",
        enqueued_at: "2026-06-10T20:00:00Z",
        verdict: null,
        verdict_notes: null,
        verdict_findings: null,
        verdict_at: null,
        review_seconds: null,
        return_to: null,
        webhook_delivered_at: null,
      },
    };
    expect(AbogadosPollingResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe("LEGAL_VALIDATION_ACTIVE_STATUSES", () => {
  it("contains expected active statuses", () => {
    expect(LEGAL_VALIDATION_ACTIVE_STATUSES).toContain("pending");
    expect(LEGAL_VALIDATION_ACTIVE_STATUSES).toContain("sent");
    expect(LEGAL_VALIDATION_ACTIVE_STATUSES).toContain("queued");
    expect(LEGAL_VALIDATION_ACTIVE_STATUSES).toContain("in_review");
  });
});
